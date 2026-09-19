"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.query = query;
exports.checkConnection = checkConnection;
exports.closePool = closePool;
const pg_1 = require("pg");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
// Load .env from project root if not already set
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();
const connectionString = process.env.DATABASE_POOLED_URL ||
    process.env.DATABASE_URL ||
    'postgres://postgres:postgrespassword@localhost:5432/repo_intelligence';
exports.pool = new pg_1.Pool({
    connectionString,
    ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
async function query(text, params) {
    const start = Date.now();
    try {
        const res = await exports.pool.query(text, params);
        const duration = Date.now() - start;
        if (process.env.DEBUG_SQL === 'true') {
            console.log('Executed query', { text, duration, rows: res.rowCount });
        }
        return res;
    }
    catch (error) {
        console.error('Database query error:', { text, error });
        throw error;
    }
}
async function checkConnection() {
    try {
        const res = await query('SELECT 1 as connected');
        return res.rows[0]?.connected === 1;
    }
    catch (err) {
        return false;
    }
}
async function closePool() {
    await exports.pool.end();
}
