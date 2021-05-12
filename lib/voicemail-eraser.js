"use strict";
const axios = require('axios');
const moment = require('moment-timezone');
const proxy = require('proxy-agent');

let minRetentionDays = 7;
let defaultRetentionDays = 30;
let defaultInvocationPageSize = 100;
let defaultInvocationAsyncLimit = 20;
let defaultInvocationRecordLimit = 1000;
const twilioRootUrl = 'https://api.twilio.com';

module.exports = class VoicemailEraser {
    constructor(options) {
        if (!options) { throw new Error("missing parameter 'options'."); }
        this.options = options
        let rDays = options.retentionDays || defaultRetentionDays;
        this.retentionDays = rDays < minRetentionDays ? minRetentionDays : rDays;
        this.invocationPageSize = options.invocationPageSize || defaultInvocationPageSize;
        this.invocationAsyncLimit = options.invocationAsyncLimit || defaultInvocationAsyncLimit;
        this.invocationRecordLimit = options.invocationRecordLimit || defaultInvocationRecordLimit;
        if (options.proxy) {
            axios.defaults.proxy = false;
            axios.defaults.httpsAgent = proxy(options.proxy);
        }
        this.apiClient = axios.create({
            baseURL: `${twilioRootUrl}/2010-04-01/Accounts/${options.twilioAccountId}`,
            withCredentials: true,
            auth: {
                username: options.twilioAccountId,
                password: options.twilioAuthToken
            }
        });
    }

    listVoicemails = async url => {
        let res = await this.apiClient.get(url);
        return res.data;
    }

    listOutdatedVoicemails = async targetDate => {
        let url = `/Recordings.json?PageSize=${this.invocationPageSize}&DateCreated<=${targetDate.utc().format('YYYY-MM-DD')}`;
        return await this.listVoicemails(url);
    }

    processOutdatedVoicemails = async targetDate => {
        let res = await this.listOutdatedVoicemails(targetDate);
        await this.processOutdatedVoicemailItems(res.recordings);
        console.log(`${res.end <= 0 ? res.end : res.end + 1} voicemails processed.`);
        while (res.next_page_uri && res.end < this.invocationRecordLimit) {
            res = await this.listVoicemails(`${twilioRootUrl}${res.next_page_uri}`);
            await this.processOutdatedVoicemailItems(res.recordings);
            console.log(`${res.end + 1} voicemails processed.`);
        }
    }

    eraseVoicemail = async voicemail => {
        let callRes = this.apiClient.get(`Calls/${voicemail.call_sid}.json`);
        let fetchVoicemail = this.options.fetchVoicemail && this.options.fetchVoicemail.toLowerCase() === 'true'.toLowerCase();
        let voiceMessage;
        if (fetchVoicemail) {
            let msgRes = this.apiClient.get(`Recordings/${voicemail.sid}.mp3`, {
                responseType: 'arraybuffer'
            });
            voiceMessage = (await msgRes).data;
        }
        let callInfo = (await callRes).data;
        if (this.preAction) { this.preAction(voicemail, callInfo, voiceMessage); }
        await this.apiClient.delete(voicemail.uri);
        if (this.postAction) { this.postAction(voicemail, callInfo, voiceMessage); }
        return;
    }

    invokeFunction = (fn, n) => {
        let pendingPromises = [];
        return async function (...args) {
            while (pendingPromises.length >= n) {
                await Promise.race(pendingPromises).catch(() => { });
            }
            const p = fn.apply(this, args);
            pendingPromises.push(p);
            await p.catch(() => { });
            pendingPromises = pendingPromises.filter(pending => pending !== p);
            return p;
        };
    };
    eraseVoicemailAsync = this.invokeFunction(this.eraseVoicemail, this.invocationAsyncLimit);

    processOutdatedVoicemailItems = async voicemails => {
        await Promise.allSettled(voicemails.map(async vm => {
            return this.eraseVoicemailAsync(vm);
        }));
    }

    eraseVoicemails = async (targetDate, preAction, postAction) => {
        this.preAction = preAction;
        this.postAction = postAction;
        let expiryDate = moment(targetDate, "YYYY-MM-DD").add(- this.retentionDays, 'days');
        return await this.processOutdatedVoicemails(expiryDate);
    };
}
