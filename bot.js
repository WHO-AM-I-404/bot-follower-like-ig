const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs/promises');
const path = require('path');

// Gunakan plugin stealth untuk membuat bot lebih sulit terdeteksi
puppeteer.use(StealthPlugin());

// --- IMPORT KONFIGURASI & PATH FILE ---
const config = require('./config.json');
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
const FOLLOW_TARGETS_FILE = path.join(__dirname, 'followers.txt');
const LIKE_TARGETS_FILE = path.join(__dirname, 'like.txt');
const PROCESSED_LOG = path.join(__dirname, 'processed_accounts.log');
const ACTIVITY_LOG = path.join(__dirname, 'bot_activity.log');

class FinalInstagramBot {
    constructor() {
        this.browser = null;
        this.page = null;
        this.processedAccounts = new Set(); // Set untuk melacak akun yang sudah diproses
    }

    /**
     * Mencatat aktivitas ke console dan ke file log.
     * @param {string} message - Pesan yang akan dicatat.
     */
    async logActivity(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        console.log(message); // Tampilkan di console
        await fs.appendFile(ACTIVITY_LOG, logMessage, 'utf-8');
    }

    /**
     * Menginisialisasi instance browser Puppeteer dengan argumen yang sesuai untuk Linux.
     */
    async initBrowser() {
        await this.logActivity("🚀 Meluncurkan browser...");
        this.browser = await puppeteer.launch({
            headless: config.settings.headless,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                '--single-process', '--disable-gpu' // Argumen penting untuk menjalankan di server/Linux
            ]
        });
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 800 });
        await this.logActivity("✅ Browser berhasil diluncurkan.");
    }

    /**
     * Memuat daftar akun yang sudah pernah diproses dari file log untuk melanjutkan proses.
     */
    async loadProcessedAccounts() {
        try {
            const data = await fs.readFile(PROCESSED_LOG, 'utf-8');
            this.processedAccounts = new Set(data.split('\n').filter(line => line.trim()));
            await this.logActivity(`📜 ${this.processedAccounts.size} akun yang sudah diproses dimuat dari log.`);
        } catch (error) {
            await this.logActivity("📜 File log tidak ditemukan, memulai dari awal.");
        }
    }

    /**
     * Membersihkan sesi browser (cookies dan localStorage) untuk persiapan login akun berikutnya.
     */
    async clearSession() {
        await this.logActivity("🧹 Membersihkan sesi browser (cookies & localStorage)...");
        const cookies = await this.page.cookies();
        if (cookies.length > 0) {
            await this.page.deleteCookie(...cookies);
        }
        await this.page.evaluate(() => localStorage.clear());
    }

    /**
     * Melakukan proses login ke Instagram.
     * @param {string} username - Username akun.
     * @param {string} password - Password akun.
     * @returns {boolean} - True jika login berhasil, false jika gagal.
     */
    async login(username, password) {
        try {
            await this.logActivity(`🔑 Mencoba login sebagai ${username}...`);
            await this.page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'networkidle2' });

            await this.page.waitForSelector('input[name="username"]');
            await this.page.type('input[name="username"]', username, { delay: 100 });
            await this.page.type('input[name="password"]', password, { delay: 100 });
            await this.page.click('button[type="submit"]');

            // Tunggu hingga navigasi selesai setelah login
            await this.page.waitForNavigation({ waitUntil: 'networkidle2' });
            await this.logActivity(`✅ Login sebagai ${username} berhasil!`);
            return true;
        } catch (error) {
            await this.logActivity(`❌ Gagal login sebagai ${username}: ${error.message}`);
            return false;
        }
    }

    /**
     * Menunggu secara acak dalam rentang waktu tertentu untuk meniru perilaku manusia.
     * @param {number} min - Jeda minimum dalam detik.
     * @param {number} max - Jeda maksimum dalam detik.
     */
    async randomDelay(min, max) {
        const delay = Math.random() * (max - min) * 1000 + min * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    // --- MODE 1: FOLLOW ---
    async runFollowMode() {
        await this.logActivity("\n--- MENJALANKAN MODE 1: FOLLOW ---");
        const targets = await fs.readFile(FOLLOW_TARGETS_FILE, 'utf-8');
        const targetAccounts = targets.split('\n').filter(line => line.trim());
        const { countPerAccount, minDelay, maxDelay } = config.settings.follow;

        for (const account of targetAccounts) {
            await this.logActivity(`🔥 Mengikuti ${countPerAccount} follower dari @${account}...`);
            await this.page.goto(`https://www.instagram.com/${account}/`, { waitUntil: 'networkidle2' });
            await this.page.waitForTimeout(2000);

            await this.page.click(`a[href='/${account}/followers/']`);
            await this.page.waitForSelector('div[role="dialog"]');

            let followed = 0;
            while (followed < countPerAccount) {
                await this.page.evaluate(() => { const dialog = document.querySelector('div[role="dialog"]'); if(dialog) dialog.scrollTop = dialog.scrollHeight; });
                await this.page.waitForTimeout(2000);

                const followButtons = await this.page.$$('div[role="dialog"] button');
                for (const button of followButtons) {
                    const text = await this.page.evaluate(el => el.textContent, button);
                    if (text === 'Follow' && followed < countPerAccount) {
                        await button.click();
                        followed++;
                        await this.logActivity(`✅ Berhasil mengikuti ${followed}/${countPerAccount} orang.`);
                        await this.randomDelay(minDelay, maxDelay);
                    }
                }
            }
        }
    }

    // --- MODE 2: LIKE ---
    async runLikeMode() {
        await this.logActivity("\n--- MENJALANKAN MODE 2: LIKE POSTINGAN ---");
        const targets = await fs.readFile(LIKE_TARGETS_FILE, 'utf-8');
        const targetUrls = targets.split('\n').filter(line => line.trim());
        const { minDelay, maxDelay } = config.settings.like;

        for (const postUrl of targetUrls) {
            await this.logActivity(`❤️ Mencoba like postingan: ${postUrl}`);
            try {
                await this.page.goto(postUrl, { waitUntil: 'networkidle2' });
                await this.page.waitForTimeout(3000);

                const likeButton = await this.page.$('span[aria-label="Suka"]');
                if (likeButton) {
                    await likeButton.click();
                    await this.logActivity("✅ Berhasil memberi like.");
                } else {
                    await this.logActivity("⚠️ Tombol like tidak ditemukan.");
                }
                await this.randomDelay(minDelay, maxDelay);
            } catch (error) {
                await this.logActivity(`❌ Gagal memproses postingan: ${error.message}`);
            }
        }
    }

    /**
     * Menjalankan tugas utama (follow atau like) untuk satu akun.
     * @param {string} username - Username akun.
     * @param {string} password - Password akun.
     */
    async processAccount(username, password) {
        if (await this.login(username, password)) {
            if (config.mode === 'follow') {
                await this.runFollowMode();
            } else if (config.mode === 'like') {
                await this.runLikeMode();
            } else {
                await this.logActivity("⚠️ Mode tidak dikenali. Periksa config.json.");
            }
        }
    }

    /**
     * Fungsi utama untuk menjalankan seluruh logika bot.
     */
    async run() {
        await this.loadProcessedAccounts();
        await this.initBrowser();

        const accountsData = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
        
        // Parsing file accounts.txt dengan format baru
        const accountBlocks = accountsData.split('--').map(block => block.trim()).filter(block => block);
        const accounts = [];
        for (const block of accountBlocks) {
            const lines = block.split('\n').map(line => line.trim());
            if (lines.length >= 2) {
                accounts.push({ username: lines[0], password: lines[1] });
            }
        }

        for (const account of accounts) {
            const { username, password } = account;

            if (this.processedAccounts.has(username)) {
                await this.logActivity(`⏭️ Akun ${username} sudah diproses, melewati.`);
                continue;
            }

            await this.logActivity(`\n========================================`);
            await this.logActivity(`🤖 MEMPROSES AKUN: ${username}`);
            await this.logActivity(`========================================`);

            await this.processAccount(username, password);
            
            await this.clearSession();
            await fs.appendFile(PROCESSED_LOG, `${username}\n`);
            this.processedAccounts.add(username);

            if (accounts.indexOf(account) < accounts.length - 1) {
                await this.logActivity(`\n⏳ Menunggu ${config.settings.globalDelay} detik sebelum beralih ke akun berikutnya...`);
                await new Promise(resolve => setTimeout(resolve, config.settings.globalDelay * 1000));
            }
        }

        await this.logActivity("\n🎉 Semua akun telah diproses!");
        await this.browser.close();
    }
}

// --- EKSEKUSI UTAMA ---
(async () => {
    const bot = new FinalInstagramBot();
    await bot.run();
})();
