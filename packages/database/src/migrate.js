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
exports.runMigrations = runMigrations;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_js_1 = require("./client.js");
async function runMigrations() {
    const dimensions = process.env.EMBEDDING_DIMENSIONS || '1024';
    console.log(`[Database] Running migrations with EMBEDDING_DIMENSIONS=${dimensions}...`);
    const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
    const migrationsDir = path.resolve(currentDir, '../migrations');
    // Read and sort all .sql migration files
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql') && !f.includes('alter_embedding'))
        .sort();
    for (const file of files) {
        console.log(`[Database] Applying migration: ${file}...`);
        const filePath = path.join(migrationsDir, file);
        let sql = fs.readFileSync(filePath, 'utf8');
        // Replace configurable dimension placeholder
        sql = sql.replace(/\{\{EMBEDDING_DIMENSIONS\}\}/g, dimensions);
        try {
            await (0, client_js_1.query)(sql);
            console.log(`[Database] Migration ${file} applied successfully.`);
        }
        catch (error) {
            console.error(`[Database] Migration ${file} failed:`, error);
            throw error;
        }
    }
}
// If run directly via tsx/node
if (require.main === module) {
    runMigrations()
        .then(() => client_js_1.pool.end())
        .catch(() => {
        client_js_1.pool.end();
        process.exit(1);
    });
}
