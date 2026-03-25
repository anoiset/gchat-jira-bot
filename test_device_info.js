import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getDeviceInfo(email) {
  try {
    const deviceDataPath = path.join(__dirname, "device_info.json");
    const deviceData = JSON.parse(fs.readFileSync(deviceDataPath, "utf-8"));
    
    return deviceData[email] || deviceData["default"];
  } catch (err) {
    console.error("Error reading device info:", err.message);
    return {
      watchMAC: "N/A",
      watchVersion: "N/A",
      mobileVersion: "N/A",
      appVersion: "N/A"
    };
  }
}

// Test cases
console.log("=== Testing Device Info Lookup ===\n");

console.log("1. Known user (kumar.aniket@nexxbase.com):");
console.log(getDeviceInfo("kumar.aniket@nexxbase.com"));

console.log("\n2. Another known user (john.doe@example.com):");
console.log(getDeviceInfo("john.doe@example.com"));

console.log("\n3. Unknown user (fallback to default):");
console.log(getDeviceInfo("unknown@example.com"));

console.log("\n4. Description preview:");
const deviceInfo = getDeviceInfo("kumar.aniket@nexxbase.com");
const originalDescription = "The login button is not working on the mobile app.";
const finalDescription = `【Watch MAC】${deviceInfo.watchMAC}
【Watch Version】${deviceInfo.watchVersion}
【Mobile Version】${deviceInfo.mobileVersion}
【App Version】${deviceInfo.appVersion}

────────────────────

${originalDescription}`;

console.log("\n" + finalDescription);
