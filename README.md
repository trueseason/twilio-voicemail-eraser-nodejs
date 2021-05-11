# twilio-voicemail-archiver

This repository is a testing sample to archive Twilio voicemail to AWS S3 bucket and delete the original items from Twilio, based on current date and the specified retention days.

## dependencies
aws-sdk
aws-parameterstore-reader
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