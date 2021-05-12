"use strict";

const aws = require('aws-sdk');
const configReader = require('aws-parameterstore-reader');
const axios = require('axios');
const moment = require('moment-timezone');

let twApi;
let retentionDays = 30;
let minRetentionDays = 7;
let invocationPageSize = 100;
let invocationAsyncLimit = 20;
let invocationRecordLimit = 1000;
let archiveS3Bucket = 'voicemail-archives';
const twilioRootUrl = 'https://api.twilio.com';
const s3 = new aws.S3({ apiVersion: '2006-03-01' });

class Archiver {
    constructor(awsOptions, proxy) {
        if (awsOptions) {
            aws.config.update(awsOptions);
        }
        if (proxy) {
            axios.defaults.proxy = false;
            axios.defaults.httpsAgent = proxy;
        }
    }

    async archiveVoicemails() {
        return archiveVoicemails();
    }
}

const archiveVoicemails = async () => {
    let cr = new configReader();
    let config = await cr.read(`/${process.env.ApplicationId}/${process.env.Environment}`);
    twApi = axios.create({
        baseURL: `${twilioRootUrl}/2010-04-01/Accounts/${config.twilioAccountId}`,
        withCredentials: true,
        auth: {
            username: config.twilioAccountId,
            password: config.twilioAuthToken
        }
    });
    retentionDays = config.retentionDays || process.env.RetentionDays || retentionDays;
    retentionDays = retentionDays < minRetentionDays ? minRetentionDays : retentionDays;
    invocationPageSize = config.invocationPageSize || process.env.InvocationPageSize || invocationPageSize;
    invocationAsyncLimit = config.invocationAsyncLimit || process.env.InvocationAsyncLimit || invocationAsyncLimit;
    invocationRecordLimit = config.invocationRecordLimit || process.env.InvocationRecordLimit || invocationRecordLimit;
    archiveS3Bucket = config.archiveS3Bucket || process.env.ArchiveS3Bucket || archiveS3Bucket;
    let targetDate = moment("2020-09-01", "YYYY-MM-DD").add(-retentionDays, 'days'); //moment().add(-retentionDays, 'days');
    await processOutdatedVoicemails(targetDate);
    return { statusCode: 200 };
};
const handler = archiveVoicemails;
module.exports = { Archiver, archiveVoicemails: archiveVoicemails, handler };

const invokeFunction = (fn, n) => {
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

let listVoicemails = async url => {
    let res = await twApi.get(url);
    return res.data;
}

let listOutdatedVoicemails = async targetDate => {
    let url = `/Recordings.json?PageSize=${invocationPageSize}&DateCreated<=${targetDate.utc().format('YYYY-MM-DD')}`;
    return await listVoicemails(url);
}

let processOutdatedVoicemails = async targetDate => {
    let res = await listOutdatedVoicemails(targetDate);
    await processOutdatedVoicemailItems(res.recordings);
    console.log(`${res.end <= 0 ? res.end : res.end + 1} voicemails processed.`);
    while (res.next_page_uri && res.end < invocationRecordLimit) {
        res = await listVoicemails(`${twilioRootUrl}${res.next_page_uri}`);
        await processOutdatedVoicemailItems(res.recordings);
        console.log(`${res.end + 1} voicemails processed.`);
    }
}

let archiveVoicemail = async voicemail => {
    if (voicemail.status === 'completed') {
        await backupVoicemail(voicemail);
    } else {
        console.log(`Invalid status: ${voicemail.sid} - ${voicemail.status}`);
    }
    return;
    //return await twApi.delete(voicemail.uri);
}

let archiveVoicemailAsync = invokeFunction(archiveVoicemail, invocationAsyncLimit);

let processOutdatedVoicemailItems = async voicemails => {
    await Promise.all(voicemails.map(async vm => {
        return archiveVoicemailAsync(vm);
    }));
}

let backupVoicemail = async voicemail => {
    let msgRes = await twApi.get(`Recordings/${voicemail.sid}.mp3`, {
        responseType: 'arraybuffer'
    });
    let callRes = await twApi.get(`Calls/${voicemail.call_sid}.json`);
    let dateCreated = moment(voicemail.date_created);
    let key = `${dateCreated.utc().format('YYYY')}/${dateCreated.utc().format('M')}/${dateCreated.utc().format('D')}/${callRes.data.from}_${dateCreated.utc().format('YYYYMMDDTHH:mm:ss')}_UTC.mp3`;
    let params = {
        Bucket: archiveS3Bucket,
        Key: key,
        Body: msgRes.data
    };
    return await s3.upload(params).promise();
}
