# twilio-voicemail-eraser

This repository is the Node.js version of the twilio-voicemail-eraser, ported from the Python lib which could delete Twilio voicemails based on the specified date and retention days.

## dependencies
axios 
moment-timezone

## Usage

```javascript
const vma = require('../handler.js');

process.env.RetentionDays = 90;
process.env.ApplicationId = 'config-root-path';
process.env.Environment = 'Test';

async function sampleFunction() {
    return await vma.archiveVoicemails();
}
```