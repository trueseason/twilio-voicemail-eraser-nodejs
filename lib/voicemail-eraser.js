"use strict";
const axios = require('axios');
const moment = require('moment-timezone');
const proxy = require('proxy-agent');

let minRetentionDays = 7;
let defaultRetentionDays = 30;
let defaultInvocationPageSize = 100;
let defaultInvocationAsyncLimit = 20;
let defaultInvocationRecordLimit = 1000;
let defaultErrorsLimit = 100;
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
        this.errorsLimit = options.errorsLimit || defaultErrorsLimit;
        this.fetchVoicemail = options.fetchVoicemail && (options.fetchVoicemail === true || options.fetchVoicemail.toLowerCase() === 'true'.toLowerCase());
        this.deleteCallLog = options.deleteCallLog && (options.deleteCallLog === true || options.deleteCallLog.toLowerCase() === 'true'.toLowerCase());
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
        let errorCount = 0;
        let vmList = await this.listOutdatedVoicemails(targetDate);
        let processedRes = await this.processOutdatedVoicemailItems(vmList.recordings);
        errorCount += processedRes.failures;
        console.log(`${vmList.end <= 0 ? vmList.end : vmList.end + 1} voicemails processed.`);
        while (vmList.next_page_uri && vmList.end < this.invocationRecordLimit && errorCount < this.errorsLimit) {
            vmList = await this.listVoicemails(`${twilioRootUrl}${vmList.next_page_uri}`);
            processedRes = await this.processOutdatedVoicemailItems(vmList.recordings);
            errorCount += processedRes.failures;
            console.log(`${vmList.end + 1} voicemails processed.`);
        }
    }

    eraseVoicemail = async voicemail => {
        let callResUrl = `Calls/${voicemail.call_sid}.json`;
        let callRes = this.apiClient.get(callResUrl);
        let voiceMessage;
        if (this.fetchVoicemail) {
            let msgRes = await this.apiClient.get(`Recordings/${voicemail.sid}.mp3`, {
                responseType: 'arraybuffer'
            });
            voiceMessage = msgRes.data;
        }
        let callInfo = (await callRes).data;
        if (this.preAction) { await this.preAction(voicemail, callInfo, voiceMessage); }
        let deleteRec = this.apiClient.delete(voicemail.uri);
        if (this.deleteCallLog) { await this.apiClient.delete(callResUrl); }
        await deleteRec;
        if (this.postAction) { await this.postAction(voicemail, callInfo, voiceMessage); }
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
        const results = await Promise.allSettled(voicemails.map(async vm => {
            return this.eraseVoicemailAsync(vm);
        }));
        const failures = results.filter(res => res.status === 'rejected').map(res => res.reason);
        if (failures.length > 0) {
            console.error(`${failures.length} failures encountered:`, failures);
        }
        return {
            results: results,
            failures: failures.length
        }
    }

    eraseVoicemails = async (targetDate, preAction, postAction) => {
        this.preAction = preAction;
        this.postAction = postAction;
        let expiryDate = moment(targetDate, "YYYY-MM-DD").add(- this.retentionDays, 'days');
        return await this.processOutdatedVoicemails(expiryDate);
    };
}
