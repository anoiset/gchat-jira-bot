# Log Retrieval API Documentation

**Last Updated**: March 25, 2026
**Status**: Complete

## Quick Summary
API endpoint for external servers to retrieve user log files and metadata. Returns device information, log file details, and temporary signed URLs for accessing log files stored in Google Cloud Storage (production) or local file paths (development).

---

## API Endpoint Specification

### POST /api/ingest/logs/retrieve

Retrieve log metadata and downloadable files for a specific user identified by email.
**baseURL** : `https://logs-automation-326803110924.asia-south2.run.app `
**Method**: `POST`  
**Path**: `/api/ingest/logs/retrieve`  
**Authentication**: None (currently public endpoint)  
**Content-Type**: `application/json`

---

## Request Format

### Request Headers

| Header | Value | Required |
|--------|-------|----------|
| `Content-Type` | `application/json` | Yes |

### Request Body

**Schema**:
```json
{
  "email": "string"
}
```

**Parameters**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | **Yes** | User's email address used to identify and retrieve their logs |

### Request Example

```bash
curl -X POST https://your-api-domain.com/api/ingest/logs/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

```javascript
// JavaScript/Node.js Example
const response = await fetch('https://your-api-domain.com/api/ingest/logs/retrieve', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'user@example.com'
  })
});

const data = await response.json();
console.log(data);
```

```python
# Python Example
import requests

url = "https://your-api-domain.com/api/ingest/logs/retrieve"
payload = {
    "email": "user@example.com"
}

response = requests.post(url, json=payload)
data = response.json()
print(data)
```

---

## Response Format

### Success Response (200 OK)

**Production Mode** (with GCS signed URLs):

```json
{
  "success": true,
  "email": "user@example.com",
  "userId": "anonymous",
  "metadata": {
    "platform": "android",
    "appVersion": "2.1.5",
    "deviceModel": "NoiseFit Core 2",
    "deviceName": "My Watch",
    "deviceMac": "AA:BB:CC:DD:EE:FF",
    "phoneModel": "Pixel 7",
    "firmwareVersion": "1.0.2",
    "firmwareUserId": "12345",
    "hardwareInfo": "MTK2523",
    "batteryLevel": 85,
    "height": 175,
    "weight": 70,
    "age": 30,
    "lastUploadAt": "2026-03-25T10:30:00.000Z",
    "createdAt": "2026-03-20T08:00:00.000Z",
    "updatedAt": "2026-03-25T10:30:00.000Z"
  },
  "files": [
    {
      "logType": "firmwareLogs",
      "gcsPath": "gs://your-bucket/anonymous/firmwareLogs.txt",
      "signedUrl": "https://storage.googleapis.com/your-bucket/anonymous/firmwareLogs.txt?X-Goog-Algorithm=...",
      "uploadedAt": "2026-03-25T10:30:00.000Z",
      "lastProcessedAt": "2026-03-25T11:00:00.000Z",
      "urlExpiresIn": "60 minutes"
    },
    {
      "logType": "sdkLogs",
      "gcsPath": "gs://your-bucket/anonymous/sdkLogs.txt",
      "signedUrl": "https://storage.googleapis.com/your-bucket/anonymous/sdkLogs.txt?X-Goog-Algorithm=...",
      "uploadedAt": "2026-03-25T10:30:00.000Z",
      "lastProcessedAt": null,
      "urlExpiresIn": "60 minutes"
    },
    {
      "logType": "appLogs",
      "gcsPath": "gs://your-bucket/anonymous/appLogs.txt",
      "signedUrl": "https://storage.googleapis.com/your-bucket/anonymous/appLogs.txt?X-Goog-Algorithm=...",
      "uploadedAt": "2026-03-25T10:30:00.000Z",
      "lastProcessedAt": null,
      "urlExpiresIn": "60 minutes"
    }
  ],
  "filesCount": 3,
  "timestamp": "2026-03-25T12:00:00.000Z"
}
```

**Development Mode** (with local file paths):

```json
{
  "success": true,
  "email": "user@example.com",
  "userId": "anonymous",
  "metadata": {
    "platform": "android",
    "appVersion": "2.1.5",
    "deviceModel": "NoiseFit Core 2",
    "deviceName": null,
    "deviceMac": null,
    "phoneModel": null,
    "firmwareVersion": null,
    "firmwareUserId": null,
    "hardwareInfo": null,
    "batteryLevel": null,
    "height": null,
    "weight": null,
    "age": null,
    "lastUploadAt": "2026-03-25T10:30:00.000Z",
    "createdAt": "2026-03-20T08:00:00.000Z",
    "updatedAt": "2026-03-25T10:30:00.000Z"
  },
  "files": [
    {
      "logType": "firmwareLogs",
      "localPath": "C:\\uploads\\anonymous\\firmwareLogs.txt",
      "uploadedAt": "2026-03-25T10:30:00.000Z",
      "lastProcessedAt": null,
      "note": "Development mode - files are stored locally"
    },
    {
      "logType": "sdkLogs",
      "localPath": "C:\\uploads\\anonymous\\sdkLogs.txt",
      "uploadedAt": "2026-03-25T10:30:00.000Z",
      "lastProcessedAt": null,
      "note": "Development mode - files are stored locally"
    },
    {
      "logType": "appLogs",
      "localPath": "C:\\uploads\\anonymous\\appLogs.txt",
      "uploadedAt": "2026-03-25T10:30:00.000Z",
      "lastProcessedAt": null,
      "note": "Development mode - files are stored locally"
    }
  ],
  "filesCount": 3,
  "timestamp": "2026-03-25T12:00:00.000Z"
}
```

### Response Fields

#### Root Level

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` for successful requests |
| `email` | string | Email address from the request |
| `userId` | string | Internal user identifier (currently mapped from email) |
| `metadata` | object | Device and user information |
| `files` | array | List of log files available for download |
| `filesCount` | number | Number of log files returned |
| `timestamp` | string (ISO 8601) | Server timestamp when response was generated |

#### Metadata Object

| Field | Type | Description |
|-------|------|-------------|
| `platform` | string | Device platform (`android`, `ios`, or `unknown`) |
| `appVersion` | string | Mobile app version |
| `deviceModel` | string | Device model name (e.g., "NoiseFit Core 2") |
| `deviceName` | string \| null | Device name extracted from firmware logs |
| `deviceMac` | string \| null | Device MAC address |
| `phoneModel` | string \| null | Connected phone model |
| `firmwareVersion` | string \| null | Device firmware version |
| `firmwareUserId` | string \| null | User ID extracted from firmware |
| `hardwareInfo` | string \| null | Hardware chipset information |
| `batteryLevel` | number \| null | Battery level percentage (0-100) |
| `height` | number \| null | User height (cm) |
| `weight` | number \| null | User weight (kg) |
| `age` | number \| null | User age (years) |
| `lastUploadAt` | string (ISO 8601) | Last time logs were uploaded |
| `createdAt` | string (ISO 8601) | First log upload timestamp |
| `updatedAt` | string (ISO 8601) | Last update timestamp |

**Note**: Fields extracted from firmware logs will be `null` if firmware file was not uploaded or could not be parsed.

#### Files Array (Production Mode)

| Field | Type | Description |
|-------|------|-------------|
| `logType` | string | Type of log file (`firmwareLogs`, `sdkLogs`, or `appLogs`) |
| `gcsPath` | string | Full Google Cloud Storage path (e.g., `gs://bucket/userId/logType.txt`) |
| `signedUrl` | string \| null | Temporary signed URL for downloading the file |
| `uploadedAt` | string (ISO 8601) | When the file was uploaded |
| `lastProcessedAt` | string (ISO 8601) \| null | Last time the file was processed by analysis systems |
| `urlExpiresIn` | string | Expiration duration for the signed URL (always "60 minutes") |

#### Files Array (Development Mode)

| Field | Type | Description |
|-------|------|-------------|
| `logType` | string | Type of log file (`firmwareLogs`, `sdkLogs`, or `appLogs`) |
| `localPath` | string | Local file system path where the file is stored |
| `uploadedAt` | string (ISO 8601) | When the file was uploaded |
| `lastProcessedAt` | string (ISO 8601) \| null | Last time the file was processed |
| `note` | string | Always "Development mode - files are stored locally" |

---

## Error Responses

### 400 Bad Request - Missing Email

Returned when the `email` field is not provided in the request body.

```json
{
  "success": false,
  "error": "Email is required",
  "message": "Please provide email in request body"
}
```

**Common Causes**:
- Empty request body
- Missing `email` field
- `email` field is `null` or empty string

**Solution**: Ensure the request body contains a valid `email` field.

---

### 404 Not Found - No Logs Found

Returned when no log data exists for the given user email.

```json
{
  "success": false,
  "error": "No logs found for this user",
  "email": "user@example.com",
  "userId": "anonymous"
}
```

**Common Causes**:
- User has never uploaded logs
- User email does not exist in the system
- Email-to-userId mapping failed

**Solution**: Verify the user has uploaded logs first using the POST /api/ingest/logs endpoint.

---

### 500 Internal Server Error

Returned when an unexpected server error occurs during processing.

```json
{
  "success": false,
  "error": "Failed to retrieve logs",
  "message": "Detailed error message here"
}
```

**Common Causes**:
- Database connection failure
- Google Cloud Storage API errors
- File system access errors
- Invalid data in database

**Solution**: Contact API administrators or retry the request. Check server logs for detailed error information.

---

## Purpose & Use Cases

### Primary Purpose
This endpoint enables external servers and applications to retrieve user log files that were previously uploaded to the system. It serves as a bridge between the log ingestion system and downstream processing services.

### Common Use Cases

1. **External Log Analysis**
   - Third-party systems can fetch logs for custom analysis
   - Debugging services can retrieve logs for troubleshooting
   - Data warehouses can pull logs for long-term storage

2. **Customer Support**
   - Support teams can retrieve user logs using their email
   - Download logs for detailed investigation of reported issues
   - Access device metadata to understand user context

3. **Automated Processing Pipelines**
   - Scheduled jobs can fetch logs for batch processing
   - Analytics systems can consume logs for insights generation
   - ML models can access logs for training/prediction

4. **Integration with External Systems**
   - CRM systems can pull log data for user profiles
   - Ticketing systems can attach log files to support tickets
   - Monitoring systems can fetch logs for compliance audits

---

## Important Constraints & Notes

### Email-to-UserID Mapping

**Current Behavior**: 
- All emails currently map to the userId `"anonymous"`
- Hardcoded mapping for `test@example.com` and `anonymous@example.com`

**Future Enhancement**:
- Will query a users table to map email → userId
- Each email will be associated with a unique userId
- Multiple users will be supported

### Signed URL Expiration

**Production Mode**:
- Signed URLs expire after **60 minutes**
- After expiration, you must call this endpoint again to get fresh URLs
- Do not cache signed URLs beyond their expiration time
- Plan downloads to complete within the 60-minute window

**Development Mode**:
- Local file paths are returned instead of URLs
- No expiration applies to local paths
- Files are directly accessible from the file system

### Log File Types

Three types of log files are supported:

1. **firmwareLogs**: Device/firmware-level logs containing low-level system information
2. **sdkLogs**: SDK library logs from the mobile app integration
3. **appLogs**: Application-level logs from the mobile app

Not all users will have all three log types. The `files` array only contains logs that were uploaded.

### File Size Considerations

- Maximum upload size per file is 50 MB (enforced by the upload endpoint)
- Consider file sizes when downloading via signed URLs
- Implement timeout handling for large file downloads

### Rate Limiting

**Current Status**: No rate limiting implemented

**Recommendations**:
- Implement request throttling on the client side to avoid overwhelming the server
- Consider caching responses when making repeated requests for the same user
- Use the 60-minute signed URL window efficiently to avoid redundant requests

### Environment-Specific Behavior

The endpoint behaves differently based on the deployment environment:

**Production** (`NODE_ENV=production`):
- Returns signed URLs for GCS files
- Signed URLs valid for 60 minutes
- Files stored in Google Cloud Storage

**Development** (`NODE_ENV=development`):
- Returns local file paths
- No signed URLs generated
- Files stored on local disk

---

## Complete Integration Example

### Node.js with Error Handling

```javascript
async function retrieveUserLogs(email) {
  try {
    const response = await fetch('https://api.example.com/api/ingest/logs/retrieve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    if (!response.ok) {
      switch (response.status) {
        case 400:
          throw new Error(`Invalid request: ${data.error}`);
        case 404:
          throw new Error(`No logs found for user: ${email}`);
        case 500:
          throw new Error(`Server error: ${data.message}`);
        default:
          throw new Error(`Unexpected error: ${response.status}`);
      }
    }

    // Process successful response
    console.log(`Retrieved ${data.filesCount} log files for user ${data.userId}`);
    
    // Download files using signed URLs (production)
    if (data.files.length > 0 && data.files[0].signedUrl) {
      for (const file of data.files) {
        console.log(`Downloading ${file.logType} from ${file.signedUrl}`);
        // Download logic here - remember URLs expire in 60 minutes!
        const fileResponse = await fetch(file.signedUrl);
        const fileContent = await fileResponse.text();
        // Process file content...
      }
    }

    return data;

  } catch (error) {
    console.error('Failed to retrieve logs:', error.message);
    throw error;
  }
}

// Usage
retrieveUserLogs('user@example.com')
  .then(data => console.log('Success:', data))
  .catch(err => console.error('Error:', err));
```

### Python with Requests

```python
import requests
import time

def retrieve_user_logs(email):
    """
    Retrieve log files for a user by email
    
    Args:
        email (str): User's email address
        
    Returns:
        dict: Response data with metadata and files
        
    Raises:
        ValueError: If email is invalid or user not found
        RuntimeError: If server error occurs
    """
    url = "https://api.example.com/api/ingest/logs/retrieve"
    payload = {"email": email}
    
    try:
        response = requests.post(url, json=payload, timeout=30)
        data = response.json()
        
        if response.status_code == 400:
            raise ValueError(f"Invalid request: {data.get('error')}")
        elif response.status_code == 404:
            raise ValueError(f"No logs found for user: {email}")
        elif response.status_code == 500:
            raise RuntimeError(f"Server error: {data.get('message')}")
        elif response.status_code != 200:
            raise RuntimeError(f"Unexpected status {response.status_code}")
        
        print(f"Retrieved {data['filesCount']} log files for user {data['userId']}")
        
        # Download files from signed URLs
        for file_info in data.get('files', []):
            if 'signedUrl' in file_info:
                print(f"Downloading {file_info['logType']}...")
                file_response = requests.get(file_info['signedUrl'], timeout=60)
                file_content = file_response.text
                # Process file content...
                print(f"Downloaded {len(file_content)} bytes")
        
        return data
        
    except requests.exceptions.Timeout:
        raise RuntimeError("Request timed out")
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Network error: {str(e)}")

# Usage
if __name__ == "__main__":
    try:
        logs_data = retrieve_user_logs("user@example.com")
        print("Metadata:", logs_data['metadata'])
    except (ValueError, RuntimeError) as e:
        print(f"Error: {e}")
```

---

## Troubleshooting

### Issue: Signed URLs return 403 Forbidden

**Cause**: Signed URL has expired (>60 minutes old)

**Solution**: Call the `/logs/retrieve` endpoint again to generate fresh signed URLs

---

### Issue: Getting 404 even though logs were uploaded

**Cause**: Email-to-userId mapping issue or logs were uploaded with a different userId

**Solution**: 
1. Verify logs were uploaded using POST /api/ingest/logs
2. Check that the same email/userId is used for both upload and retrieval
3. Currently all requests map to userId "anonymous" - ensure this is expected

---

### Issue: Metadata fields are null

**Cause**: Certain metadata fields are extracted from firmware logs only

**Solution**: 
- Ensure firmwareLogs.txt is uploaded along with other log types
- Firmware file must be in the correct format for parsing to succeed
- Basic fields (platform, appVersion, deviceModel) come from upload request body

---

### Issue: Files array is empty

**Cause**: User has uploaded metadata but no log files

**Solution**: 
- Ensure log files (firmwareLogs, sdkLogs, appLogs) are uploaded
- Check upload endpoint response to verify files were saved successfully

---

## Related Endpoints

- **POST /api/ingest/logs** - Upload log files from mobile app
- **GET /api/ingest/metadata/:userId** - Get metadata for a specific user by userId
- **GET /api/ingest/health** - Health check for the ingest API service

---

## API Version

**Current Version**: 1.0  
**Base URL**: `https://api.example.com` (replace with your actual domain)  
**Last Updated**: March 25, 2026

---

## Support

For API support, integration questions, or to report issues:
- Check server logs for detailed error information
- Verify your request format matches the examples above
- Ensure all required headers are included
- Contact the API development team with specific error messages

---

**End of Documentation**
