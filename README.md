# twilio-voicemail-eraser

This repository is the Node.js version of the twilio-voicemail-eraser with some small enhancements, ported from the Python lib which could delete Twilio voicemails based on the specified target date and retention days.

## dependencies
axios  
moment-timezone  
proxy-agent

## Usage

```javascript
const vmeraser = require('twilio-voicemail-eraser');

let options = {
    //mandatory options:
    twilioAccountId: 'twilioAccountId',
    twilioAuthToken: 'twilioAuthToken',
    //optional options (default):
    proxy: "https://sample.my.proxy:8080",
    retentionDays: 30,
    invocationPageSize: 100,
    invocationAsyncLimit: 20,
    invocationRecordLimit: 1000,
    errorsLimit: 100,
    fetchVoicemail: false,
    deleteCallLog: false
}

let preAction = (voicemailInfo, callInfo, voiceMessage) => { console.log('Pre-Action') };
let postAction = (voicemailInfo, callInfo, voiceMessage) => { console.log('Post-Action') };

//The voicemails older than 2019-12-02 will be deleted (subtract retentionDays from 2020-01-01)
async function sampleFunction() {
    let vme = new vmeraser(options);
    return await vme.eraseVoicemails('2020-01-01', preAction, postAction);
}
```