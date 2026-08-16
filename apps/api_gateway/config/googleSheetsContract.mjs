import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GENERATED_CONTRACT_PATH = path.join(__dirname, '..', 'generated', 'google-sheets-api-gateway-contract.json');

export function loadGoogleSheetsGatewayContract() {
    return JSON.parse(fs.readFileSync(GENERATED_CONTRACT_PATH, 'utf-8'));
}
