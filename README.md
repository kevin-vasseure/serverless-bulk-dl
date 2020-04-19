# aws-bulk-download
A simple AWS SAM serverless apps that downloads files from one location, stream them to archiver, and directly stream out to a zip file on S3.
Since it's streaming, it doesn't take any tmp storage on the lambda, so the only limitation is the timeout.
