/**
 * Deploy to production with confirmation prompt.
 * Usage: node deploy-production.mjs
 */
import { createInterface } from 'readline';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROD_DIR = 'G:\\My Drive\\IT\\Obsidian Vault\\My Notebooks\\.obsidian\\plugins\\tagforge';
const FILES = ['main.js', 'manifest.json', 'styles.css'];

const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('\n⚠️  PRODUCTION DEPLOYMENT');
console.log(`Target: ${PROD_DIR}`);
console.log(`Files:  ${FILES.join(', ')}\n`);

rl.question('Are you sure you want to deploy to PRODUCTION? (yes/no): ', (answer) => {
    rl.close();

    if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Deployment cancelled.');
        process.exit(0);
    }

    try {
        if (!existsSync(PROD_DIR)) {
            mkdirSync(PROD_DIR, { recursive: true });
        }

        for (const file of FILES) {
            if (!existsSync(file)) {
                console.error(`❌ Missing file: ${file} — did you run "npm run build" first?`);
                process.exit(1);
            }
            copyFileSync(file, join(PROD_DIR, file));
            console.log(`  ✅ ${file}`);
        }

        console.log('\n🚀 Production deployment complete!');
    } catch (err) {
        console.error('❌ Deployment failed:', err.message);
        process.exit(1);
    }
});
