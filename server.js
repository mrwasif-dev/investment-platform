// ============================================================
// PROFIT 24 - COMPLETE INVESTMENT PLATFORM
// Backend: Node.js + Express + MongoDB + Telegram Bot Admin
// ============================================================

require('dotenv').config();

// ============ IMPORTS ============
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');

// ============ APP INITIALIZATION ============
const app = express();
const PORT = process.env.PORT || 5000;

// Create required directories
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads', { recursive: true });
}
if (!fs.existsSync('public')) {
    fs.mkdirSync('public', { recursive: true });
}

// ============ MIDDLEWARE SETUP ============
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============ MULTER CONFIGURATION ============
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, uniqueSuffix + '-' + safeName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// ============================================================
// MONGODB SCHEMAS & MODELS
// ============================================================

// ---------- USER SCHEMA ----------
const userSchema = new mongoose.Schema({
    username: {
        type: String,
        unique: true,
        required: [true, 'Username is required'],
        trim: true,
        minlength: 3,
        maxlength: 30
    },
    whatsapp: {
        type: String,
        required: [true, 'WhatsApp number is required'],
        trim: true
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: 6
    },
    balance: {
        type: Number,
        default: 0,
        min: 0
    },
    referralCode: {
        type: String,
        unique: true,
        uppercase: true
    },
    referredBy: {
        type: String,
        default: null
    },
    activePlan: {
        planId: { type: Number },
        name: { type: String },
        amount: { type: Number },
        dailyProfit: { type: Number },
        startDate: { type: Date },
        endDate: { type: Date },
        profitDays: { type: Number, default: 0 }
    },
    totalInvested: {
        type: Number,
        default: 0
    },
    totalEarned: {
        type: Number,
        default: 0
    },
    referralEarnings: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['active', 'blocked'],
        default: 'active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// ---------- TRANSACTION SCHEMA ----------
const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    username: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdraw', 'profit', 'referral'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    accountType: {
        type: String,
        enum: ['easypaisa', 'jazzcash', ''],
        default: ''
    },
    accountNumber: {
        type: String,
        default: ''
    },
    accountTitle: {
        type: String,
        default: ''
    },
    screenshot: {
        type: String,
        default: null
    },
    txId: {
        type: String,
        default: ''
    },
    planId: {
        type: Number,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// ---------- PLAN SCHEMA ----------
const planSchema = new mongoose.Schema({
    planId: {
        type: Number,
        unique: true,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    dailyProfit: {
        type: Number,
        default: 11,
        min: 0,
        max: 100
    },
    duration: {
        type: Number,
        default: 60,
        min: 1
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// ---------- SETTING SCHEMA ----------
const settingSchema = new mongoose.Schema({
    key: {
        type: String,
        unique: true,
        required: true
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// ---------- FAQ SCHEMA ----------
const faqSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true
    },
    answer: {
        type: String,
        required: true
    },
    order: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// ---------- CREATE MODELS ----------
const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Plan = mongoose.model('Plan', planSchema);
const Setting = mongoose.model('Setting', settingSchema);
const FAQ = mongoose.model('FAQ', faqSchema);

// ============================================================
// TELEGRAM BOT ADMIN PANEL
// ============================================================

let bot = null;
const botSessions = {};

/**
 * Initialize Telegram Bot with Admin Controls
 */
function initializeTelegramBot() {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

    if (!BOT_TOKEN || BOT_TOKEN === 'your_bot_token_here' || !ADMIN_ID) {
        console.log('⚠️  Telegram Bot: Not configured. Skipping...');
        return null;
    }

    try {
        bot = new TelegramBot(BOT_TOKEN, { polling: true });
        console.log('✅ Telegram Bot: Connected successfully!');

        // ============ KEYBOARD TEMPLATES ============
        
        function getMainMenu() {
            return {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📊 Dashboard Stats', callback_data: 'menu_dashboard' }],
                        [
                            { text: '👥 Users', callback_data: 'menu_users' },
                            { text: '💰 Deposits', callback_data: 'menu_deposits' }
                        ],
                        [
                            { text: '💸 Withdrawals', callback_data: 'menu_withdrawals' },
                            { text: '📋 Plans', callback_data: 'menu_plans' }
                        ],
                        [
                            { text: '🏦 Accounts', callback_data: 'menu_accounts' },
                            { text: '⚙️ Settings', callback_data: 'menu_settings' }
                        ],
                        [
                            { text: '🔗 Referral', callback_data: 'menu_referral' },
                            { text: '❓ FAQ', callback_data: 'menu_faq' }
                        ],
                        [{ text: '📢 Broadcast', callback_data: 'menu_broadcast' }]
                    ]
                }
            };
        }

        function getBackButton() {
            return {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Back to Menu', callback_data: 'menu_dashboard' }]
                    ]
                }
            };
        }

        // ============ COMMAND HANDLERS ============

        bot.onText(/\/start|\/admin/, async (msg) => {
            const chatId = msg.chat.id.toString();
            if (chatId !== ADMIN_ID) {
                return bot.sendMessage(chatId, '⛔ Access Denied!');
            }

            const welcomeMsg = '🔐 *ADMIN CONTROL PANEL*\n\n' +
                'Welcome! Manage your entire platform from here.\n\n' +
                'Select an option below:';

            await bot.sendMessage(chatId, welcomeMsg, {
                parse_mode: 'Markdown',
                ...getMainMenu()
            });
        });

        // ============ CALLBACK HANDLER ============

        bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id.toString();
            if (chatId !== ADMIN_ID) {
                return bot.answerCallbackQuery(query.id, { text: 'Unauthorized!' });
            }

            const action = query.data;
            await bot.answerCallbackQuery(query.id);

            try {
                // DASHBOARD
                if (action === 'menu_dashboard') {
                    const totalUsers = await User.countDocuments();
                    const activePlans = await User.countDocuments({
                        'activePlan.planId': { $exists: true },
                        status: 'active'
                    });
                    const pendingDeposits = await Transaction.countDocuments({
                        type: 'deposit',
                        status: 'pending'
                    });
                    const pendingWithdrawals = await Transaction.countDocuments({
                        type: 'withdraw',
                        status: 'pending'
                    });

                    const totalDepResult = await Transaction.aggregate([
                        { $match: { type: 'deposit', status: 'approved' } },
                        { $group: { _id: null, total: { $sum: '$amount' } } }
                    ]);

                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const todayProfitResult = await Transaction.aggregate([
                        {
                            $match: {
                                type: 'profit',
                                status: 'approved',
                                createdAt: { $gte: today }
                            }
                        },
                        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
                    ]);

                    const message = '📊 *DASHBOARD*\n\n' +
                        '━━━━━━━━━━━━━━\n\n' +
                        `👥 Users: ${totalUsers}\n` +
                        `✅ Active Plans: ${activePlans}\n` +
                        `⏳ Pending Deposits: ${pendingDeposits}\n` +
                        `⏳ Pending Withdrawals: ${pendingWithdrawals}\n` +
                        `💰 Total Deposits: PKR ${(totalDepResult[0]?.total || 0).toLocaleString()}\n` +
                        `💎 Today's Profit: PKR ${(todayProfitResult[0]?.total || 0).toLocaleString()}\n` +
                        `🔄 Profit Given: ${todayProfitResult[0]?.count || 0} times\n\n` +
                        '━━━━━━━━━━━━━━';

                    await bot.editMessageText(message, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        ...getMainMenu()
                    });
                }

                // USERS
                else if (action === 'menu_users') {
                    const users = await User.find().sort({ createdAt: -1 }).limit(25).lean();
                    let message = `👥 *USERS* (${await User.countDocuments()} total)\n\n`;

                    users.forEach((u, i) => {
                        const icon = u.status === 'blocked' ? '🔴' : (u.activePlan?.planId ? '🟢' : '🟡');
                        message += `${i + 1}. ${icon} ${u.username} | PKR ${(u.totalInvested || 0).toLocaleString()}\n`;
                    });

                    message += '\n🔍 /user <username> for details';

                    await bot.editMessageText(message, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        ...getMainMenu()
                    });
                }

                // PENDING DEPOSITS
                else if (action === 'menu_deposits') {
                    const deposits = await Transaction.find({
                        type: 'deposit',
                        status: 'pending'
                    }).sort({ createdAt: -1 }).limit(10).lean();

                    if (deposits.length === 0) {
                        return bot.editMessageText('✅ No pending deposits!', {
                            chat_id: chatId,
                            message_id: query.message.message_id,
                            ...getBackButton()
                        });
                    }

                    await bot.deleteMessage(chatId, query.message.message_id);

                    for (const dep of deposits) {
                        const msg = '💰 *PENDING DEPOSIT*\n\n' +
                            `👤 ${dep.username}\n` +
                            `💵 PKR ${dep.amount.toLocaleString()}\n` +
                            `🏦 ${dep.accountType}\n` +
                            `🔢 ${dep.txId}\n` +
                            `📅 ${new Date(dep.createdAt).toLocaleDateString()}`;

                        const kb = {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ APPROVE', callback_data: `approveDep_${dep._id}` },
                                    { text: '❌ REJECT', callback_data: `rejectDep_${dep._id}` }
                                ]]
                            }
                        };

                        if (dep.screenshot && fs.existsSync(dep.screenshot)) {
                            try {
                                await bot.sendPhoto(chatId, dep.screenshot, {
                                    caption: msg,
                                    parse_mode: 'Markdown',
                                    ...kb
                                });
                            } catch (e) {
                                await bot.sendMessage(chatId, msg, {
                                    parse_mode: 'Markdown',
                                    ...kb
                                });
                            }
                        } else {
                            await bot.sendMessage(chatId, msg, {
                                parse_mode: 'Markdown',
                                ...kb
                            });
                        }
                    }

                    await bot.sendMessage(chatId, `📋 ${deposits.length} pending deposits`, getBackButton());
                }

                // PENDING WITHDRAWALS
                else if (action === 'menu_withdrawals') {
                    const withdrawals = await Transaction.find({
                        type: 'withdraw',
                        status: 'pending'
                    }).sort({ createdAt: -1 }).limit(10).lean();

                    if (withdrawals.length === 0) {
                        return bot.editMessageText('✅ No pending withdrawals!', {
                            chat_id: chatId,
                            message_id: query.message.message_id,
                            ...getBackButton()
                        });
                    }

                    await bot.deleteMessage(chatId, query.message.message_id);

                    for (const wd of withdrawals) {
                        const user = await User.findOne({ username: wd.username }).lean();
                        const msg = '💸 *PENDING WITHDRAWAL*\n\n' +
                            `👤 ${wd.username}\n` +
                            `💰 Balance: PKR ${(user?.balance || 0).toFixed(2)}\n` +
                            `💵 Amount: PKR ${wd.amount.toLocaleString()}\n` +
                            `🏦 ${wd.accountType}: ${wd.accountNumber}\n` +
                            `📛 ${wd.accountTitle}`;

                        const kb = {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '✅ APPROVE', callback_data: `approveWd_${wd._id}` },
                                    { text: '❌ REJECT', callback_data: `rejectWd_${wd._id}` }
                                ]]
                            }
                        };

                        await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...kb });
                    }

                    await bot.sendMessage(chatId, `📋 ${withdrawals.length} pending withdrawals`, getBackButton());
                }

                // PLANS
                else if (action === 'menu_plans') {
                    const plans = await Plan.find().sort({ planId: 1 }).lean();
                    let msg = '📋 *PLANS*\n\n';

                    plans.forEach(p => {
                        const status = p.isActive ? '✅' : '❌';
                        msg += `${status} ${p.planId}. ${p.name} | PKR ${p.amount} | ${p.dailyProfit}% | ${p.duration}d\n`;
                    });

                    const kb = {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '➕ Add Plan', callback_data: 'addPlan' }],
                                [{ text: '🗑️ Delete Plan', callback_data: 'delPlanSelect' }],
                                [{ text: '🔄 Toggle Status', callback_data: 'togPlanSelect' }],
                                [{ text: '🔙 Back', callback_data: 'menu_dashboard' }]
                            ]
                        }
                    };

                    await bot.editMessageText(msg, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        ...kb
                    });
                }

                // ADD PLAN
                else if (action === 'addPlan') {
                    botSessions[chatId] = { action: 'addingPlan' };
                    await bot.sendMessage(chatId,
                        '➕ *ADD PLAN*\n\nSend:\n`Name | Amount | Profit% | Days`\n\nExample:\n`Premium | 5000 | 12 | 60`\n\n/cancel',
                        { parse_mode: 'Markdown' }
                    );
                }

                // DELETE PLAN SELECT
                else if (action === 'delPlanSelect') {
                    const plans = await Plan.find().sort({ planId: 1 }).lean();
                    const buttons = plans.map(p => [{
                        text: `🗑️ ${p.planId}. ${p.name}`,
                        callback_data: `delPlan_${p.planId}`
                    }]);
                    buttons.push([{ text: '🔙 Back', callback_data: 'menu_plans' }]);

                    await bot.editMessageText('Select plan to delete:', {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: { inline_keyboard: buttons }
                    });
                }

                // TOGGLE PLAN SELECT
                else if (action === 'togPlanSelect') {
                    const plans = await Plan.find().sort({ planId: 1 }).lean();
                    const buttons = plans.map(p => [{
                        text: `${p.isActive ? '✅' : '❌'} ${p.planId}. ${p.name}`,
                        callback_data: `togPlan_${p.planId}`
                    }]);
                    buttons.push([{ text: '🔙 Back', callback_data: 'menu_plans' }]);

                    await bot.editMessageText('Toggle plan status:', {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        reply_markup: { inline_keyboard: buttons }
                    });
                }

                // EXECUTE DELETE PLAN
                else if (action.startsWith('delPlan_')) {
                    const planId = parseInt(action.split('_')[1]);
                    const plan = await Plan.findOne({ planId });
                    if (plan) {
                        await Plan.deleteOne({ planId });
                        await bot.sendMessage(chatId, `✅ Plan ${planId} deleted!`, getMainMenu());
                    }
                }

                // EXECUTE TOGGLE PLAN
                else if (action.startsWith('togPlan_')) {
                    const planId = parseInt(action.split('_')[1]);
                    const plan = await Plan.findOne({ planId });
                    if (plan) {
                        plan.isActive = !plan.isActive;
                        await plan.save();
                        await bot.sendMessage(chatId, `✅ Plan ${planId} ${plan.isActive ? 'Activated' : 'Deactivated'}!`, getMainMenu());
                    }
                }

                // ACCOUNTS
                else if (action === 'menu_accounts') {
                    const ep = await Setting.findOne({ key: 'easypaisaNumber' });
                    const jc = await Setting.findOne({ key: 'jazzcashNumber' });

                    const msg = '🏦 *ACCOUNTS*\n\n' +
                        `Easypaisa: ${ep?.value || 'N/A'}\n` +
                        `JazzCash: ${jc?.value || 'N/A'}\n\n` +
                        '/setep number|title\n/setjc number|title';

                    await bot.editMessageText(msg, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        ...getMainMenu()
                    });
                }

                // SETTINGS
                else if (action === 'menu_settings') {
                    const minW = await Setting.findOne({ key: 'minWithdraw' });
                    const maxW = await Setting.findOne({ key: 'maxWithdraw' });
                    const dailyW = await Setting.findOne({ key: 'maxDailyWithdraw' });

                    const msg = '⚙️ *SETTINGS*\n\n' +
                        `Min WD: PKR ${minW?.value || 30}\n` +
                        `Max WD: PKR ${maxW?.value || 500000}\n` +
                        `Daily Limit: PKR ${dailyW?.value || 100000}\n\n` +
                        '/setminwd | /setmaxwd | /setdailywd';

                    await bot.editMessageText(msg, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        ...getMainMenu()
                    });
                }

                // REFERRAL
                else if (action === 'menu_referral') {
                    const ref = await Setting.findOne({ key: 'referralBonus' });
                    const msg = '🔗 *REFERRAL*\n\n' +
                        `Bonus: ${ref?.value || 11}%\n\n` +
                        '/setrefbonus percent';

                    await bot.editMessageText(msg, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        ...getMainMenu()
                    });
                }

                // FAQ
                else if (action === 'menu_faq') {
                    const faqs = await FAQ.find().sort({ order: 1 }).lean();
                    let msg = '❓ *FAQs*\n\n';
                    if (faqs.length === 0) msg += 'No FAQs\n\n';
                    else faqs.forEach((f, i) => msg += `${i + 1}. Q: ${f.question}\n   A: ${f.answer}\n\n`);
                    msg += '/addfaq Q|A\n/delfaq num\n/clearfaqs';

                    await bot.editMessageText(msg, {
                        chat_id: chatId,
                        message_id: query.message.message_id,
                        parse_mode: 'Markdown',
                        ...getMainMenu()
                    });
                }

                // BROADCAST
                else if (action === 'menu_broadcast') {
                    botSessions[chatId] = { action: 'broadcasting' };
                    await bot.sendMessage(chatId, '📢 Send message to broadcast:\n/cancel');
                }

                // APPROVE DEPOSIT
                else if (action.startsWith('approveDep_')) {
                    const tid = action.split('_')[1];
                    await handleDepositAction(tid, 'approved', chatId);
                }

                // REJECT DEPOSIT
                else if (action.startsWith('rejectDep_')) {
                    const tid = action.split('_')[1];
                    await handleDepositAction(tid, 'rejected', chatId);
                }

                // APPROVE WITHDRAWAL
                else if (action.startsWith('approveWd_')) {
                    const tid = action.split('_')[1];
                    await handleWithdrawalAction(tid, 'approved', chatId);
                }

                // REJECT WITHDRAWAL
                else if (action.startsWith('rejectWd_')) {
                    const tid = action.split('_')[1];
                    await handleWithdrawalAction(tid, 'rejected', chatId);
                }

                // TOGGLE USER
                else if (action.startsWith('toggleUser_')) {
                    const username = action.split('_')[1];
                    const user = await User.findOne({ username });
                    if (user) {
                        user.status = user.status === 'active' ? 'blocked' : 'active';
                        await user.save();
                        await bot.sendMessage(chatId, `✅ ${username} → ${user.status}`);
                    }
                }

            } catch (error) {
                console.error('Bot callback error:', error.message);
                await bot.sendMessage(chatId, '❌ Error: ' + error.message);
            }
        });

        // ============ TEXT MESSAGE HANDLER ============

        bot.on('message', async (msg) => {
            const chatId = msg.chat.id.toString();
            if (chatId !== ADMIN_ID || !msg.text) return;

            const text = msg.text.trim();
            const session = botSessions[chatId];

            // CANCEL
            if (text === '/cancel') {
                delete botSessions[chatId];
                return bot.sendMessage(chatId, '❌ Cancelled', getMainMenu());
            }

            // ADD PLAN SESSION
            if (session && session.action === 'addingPlan') {
                const parts = text.split('|').map(s => s.trim());
                if (parts.length < 4) {
                    return bot.sendMessage(chatId, '❌ Format: Name|Amount|Profit%|Days');
                }
                const lastPlan = await Plan.findOne().sort({ planId: -1 });
                const newId = (lastPlan?.planId || 0) + 1;
                await new Plan({
                    planId: newId,
                    name: parts[0],
                    amount: parseInt(parts[1]),
                    dailyProfit: parseFloat(parts[2]),
                    duration: parseInt(parts[3])
                }).save();
                delete botSessions[chatId];
                return bot.sendMessage(chatId, `✅ Plan ${newId} added!`, getMainMenu());
            }

            // BROADCAST SESSION
            if (session && session.action === 'broadcasting') {
                const users = await User.find({ status: 'active' });
                let sent = 0;
                for (const user of users) {
                    try {
                        await bot.sendMessage(user._id, '📢 *Admin*\n\n' + text, { parse_mode: 'Markdown' });
                        sent++;
                    } catch (e) { }
                }
                delete botSessions[chatId];
                return bot.sendMessage(chatId, `✅ Sent to ${sent}/${users.length}`, getMainMenu());
            }

            // SET EASYPAISA
            if (text.startsWith('/setep ')) {
                const p = text.slice(7).split('|').map(s => s.trim());
                if (p.length < 2) return bot.sendMessage(chatId, '❌ /setep number|title');
                await Setting.findOneAndUpdate({ key: 'easypaisaNumber' }, { value: p[0] }, { upsert: true });
                await Setting.findOneAndUpdate({ key: 'easypaisaTitle' }, { value: p[1] }, { upsert: true });
                return bot.sendMessage(chatId, '✅ Easypaisa updated!');
            }

            // SET JAZZCASH
            if (text.startsWith('/setjc ')) {
                const p = text.slice(7).split('|').map(s => s.trim());
                if (p.length < 2) return bot.sendMessage(chatId, '❌ /setjc number|title');
                await Setting.findOneAndUpdate({ key: 'jazzcashNumber' }, { value: p[0] }, { upsert: true });
                await Setting.findOneAndUpdate({ key: 'jazzcashTitle' }, { value: p[1] }, { upsert: true });
                return bot.sendMessage(chatId, '✅ JazzCash updated!');
            }

            // SETTINGS COMMANDS
            if (text.startsWith('/setminwd ')) {
                await Setting.findOneAndUpdate({ key: 'minWithdraw' }, { value: parseInt(text.slice(10)) }, { upsert: true });
                return bot.sendMessage(chatId, '✅ Updated!');
            }
            if (text.startsWith('/setmaxwd ')) {
                await Setting.findOneAndUpdate({ key: 'maxWithdraw' }, { value: parseInt(text.slice(10)) }, { upsert: true });
                return bot.sendMessage(chatId, '✅ Updated!');
            }
            if (text.startsWith('/setdailywd ')) {
                await Setting.findOneAndUpdate({ key: 'maxDailyWithdraw' }, { value: parseInt(text.slice(12)) }, { upsert: true });
                return bot.sendMessage(chatId, '✅ Updated!');
            }
            if (text.startsWith('/setrefbonus ')) {
                await Setting.findOneAndUpdate({ key: 'referralBonus' }, { value: parseFloat(text.slice(13)) }, { upsert: true });
                return bot.sendMessage(chatId, '✅ Updated!');
            }

            // FAQ COMMANDS
            if (text.startsWith('/addfaq ')) {
                const p = text.slice(8).split('|').map(s => s.trim());
                if (p.length < 2) return bot.sendMessage(chatId, '❌ /addfaq Q|A');
                const count = await FAQ.countDocuments();
                await new FAQ({ question: p[0], answer: p[1], order: count + 1 }).save();
                return bot.sendMessage(chatId, '✅ FAQ added!');
            }
            if (text.startsWith('/delfaq ')) {
                const n = parseInt(text.slice(8));
                const faqs = await FAQ.find().sort({ order: 1 });
                if (n > 0 && n <= faqs.length) {
                    await FAQ.findByIdAndDelete(faqs[n - 1]._id);
                    return bot.sendMessage(chatId, `✅ FAQ #${n} deleted!`);
                }
                return bot.sendMessage(chatId, '❌ Invalid number');
            }
            if (text === '/clearfaqs') {
                await FAQ.deleteMany({});
                return bot.sendMessage(chatId, '✅ All FAQs deleted!');
            }

            // USER INFO
            if (text.startsWith('/user ')) {
                const username = text.slice(6).trim();
                const user = await User.findOne({ username }).lean();
                if (!user) return bot.sendMessage(chatId, '❌ Not found');

                const planInfo = user.activePlan?.planId
                    ? `${user.activePlan.name} (${user.activePlan.profitDays}/60)`
                    : 'None';

                const refCount = await User.countDocuments({ referredBy: user.referralCode });

                const msg = '👤 *USER INFO*\n\n' +
                    `Username: ${user.username}\n` +
                    `WhatsApp: ${user.whatsapp}\n` +
                    `Status: ${user.status}\n` +
                    `Balance: PKR ${(user.balance || 0).toFixed(2)}\n` +
                    `Plan: ${planInfo}\n` +
                    `Invested: PKR ${(user.totalInvested || 0).toLocaleString()}\n` +
                    `Earned: PKR ${(user.totalEarned || 0).toLocaleString()}\n` +
                    `Referrals: ${refCount}\n` +
                    `Joined: ${new Date(user.createdAt).toLocaleDateString()}`;

                const kb = {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: user.status === 'active' ? '🔴 Block' : '🟢 Unblock',
                                callback_data: `toggleUser_${user.username}`
                            }
                        ]]
                    }
                };

                return bot.sendMessage(chatId, msg, { parse_mode: 'Markdown', ...kb });
            }
        });

        console.log('✅ Telegram Bot: All handlers registered');

    } catch (error) {
        console.error('❌ Telegram Bot Error:', error.message);
        bot = null;
    }
}

// ============ HELPER FUNCTIONS ============

async function handleDepositAction(tid, status, chatId) {
    const tx = await Transaction.findById(tid);
    if (!tx) return bot.sendMessage(chatId, '❌ Not found');
    if (tx.status !== 'pending') return bot.sendMessage(chatId, `Already ${tx.status}`);

    tx.status = status;
    await tx.save();

    if (status === 'approved') {
        const user = await User.findOne({ username: tx.username });
        const plan = await Plan.findOne({ planId: tx.planId });

        if (user && plan) {
            const dailyProfit = plan.amount * (plan.dailyProfit / 100);
            user.activePlan = {
                planId: plan.planId,
                name: plan.name,
                amount: plan.amount,
                dailyProfit: dailyProfit,
                startDate: new Date(),
                endDate: new Date(Date.now() + plan.duration * 86400000),
                profitDays: 0
            };
            user.totalInvested += plan.amount;

            const firstProfit = dailyProfit;
            user.balance += firstProfit;
            user.totalEarned += firstProfit;
            user.activePlan.profitDays += 1;
            await user.save();

            await new Transaction({
                userId: user._id,
                username: user.username,
                type: 'profit',
                amount: firstProfit,
                status: 'approved'
            }).save();

            if (user.referredBy) {
                const referrer = await User.findOne({ referralCode: user.referredBy });
                if (referrer) {
                    const bonusPct = await Setting.findOne({ key: 'referralBonus' });
                    const bonus = plan.amount * ((bonusPct?.value || 11) / 100);
                    referrer.balance += bonus;
                    referrer.referralEarnings += bonus;
                    await referrer.save();

                    await new Transaction({
                        userId: referrer._id,
                        username: referrer.username,
                        type: 'referral',
                        amount: bonus,
                        status: 'approved'
                    }).save();

                    bot.sendMessage(chatId, `🎁 Bonus PKR ${bonus} → ${referrer.username}`);
                }
            }
        }
    }

    bot.sendMessage(chatId, `✅ Deposit ${status}!`);
}

async function handleWithdrawalAction(tid, status, chatId) {
    const tx = await Transaction.findById(tid);
    if (!tx) return bot.sendMessage(chatId, '❌ Not found');
    if (tx.status !== 'pending') return bot.sendMessage(chatId, `Already ${tx.status}`);

    tx.status = status;
    await tx.save();

    if (status === 'approved') {
        const user = await User.findOne({ username: tx.username });
        if (user) {
            user.balance -= tx.amount;
            await user.save();
        }
    }

    bot.sendMessage(chatId, `✅ Withdrawal ${status}!`);
}

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, error: 'Login required' });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
    }
}

// ============================================================
// API ROUTES
// ============================================================

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Profit 24 API Running',
        time: new Date().toISOString()
    });
});

// Signup
app.post('/api/signup', async (req, res) => {
    try {
        const { username, whatsapp, password, referralCode } = req.body;

        if (!username || !whatsapp || !password) {
            return res.status(400).json({ success: false, error: 'All fields required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be 6+ characters' });
        }

        const existing = await User.findOne({ username });
        if (existing) {
            return res.status(400).json({ success: false, error: 'Username taken' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const refCode = Math.random().toString(36).substring(2, 10).toUpperCase();

        const user = new User({
            username,
            whatsapp,
            password: hashedPassword,
            referralCode: refCode,
            referredBy: referralCode || null
        });

        await user.save();

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            success: true,
            message: 'Account created!',
            token,
            username: user.username,
            referralCode: user.referralCode
        });

    } catch (error) {
        console.error('Signup error:', error.message);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Username and password required' });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ success: false, error: 'Invalid credentials' });
        }

        if (user.status === 'blocked') {
            return res.status(403).json({ success: false, error: 'Account blocked' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ success: false, error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.json({
            success: true,
            message: 'Login successful!',
            token,
            username: user.username,
            balance: user.balance
        });

    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// Dashboard
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayProfit = await Transaction.aggregate([
            {
                $match: {
                    userId: user._id,
                    type: 'profit',
                    status: 'approved',
                    createdAt: { $gte: today }
                }
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const referralCount = await User.countDocuments({ referredBy: user.referralCode });

        res.json({
            success: true,
            username: user.username,
            balance: user.balance || 0,
            activePlan: user.activePlan || null,
            totalInvested: user.totalInvested || 0,
            totalEarned: user.totalEarned || 0,
            referralEarnings: user.referralEarnings || 0,
            referralCount: referralCount,
            referralCode: user.referralCode,
            todayProfit: todayProfit[0]?.total || 0
        });

    } catch (error) {
        console.error('Dashboard error:', error.message);
        res.status(500).json({ success: false, error: 'Error loading dashboard' });
    }
});

// Get Plans
app.get('/api/plans', authenticateToken, async (req, res) => {
    try {
        const plans = await Plan.find({ isActive: true }).sort({ planId: 1 }).lean();
        res.json({ success: true, plans });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error loading plans' });
    }
});

// Get Deposit Accounts
app.get('/api/deposit-accounts', authenticateToken, async (req, res) => {
    try {
        const [epNum, epTitle, jcNum, jcTitle] = await Promise.all([
            Setting.findOne({ key: 'easypaisaNumber' }),
            Setting.findOne({ key: 'easypaisaTitle' }),
            Setting.findOne({ key: 'jazzcashNumber' }),
            Setting.findOne({ key: 'jazzcashTitle' })
        ]);

        res.json({
            success: true,
            easypaisa: {
                number: epNum?.value || 'Not set',
                title: epTitle?.value || 'Not set'
            },
            jazzcash: {
                number: jcNum?.value || 'Not set',
                title: jcTitle?.value || 'Not set'
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Error loading accounts' });
    }
});

// Submit Deposit
app.post('/api/deposit', authenticateToken, upload.single('screenshot'), async (req, res) => {
    try {
        const { planId, accountType, txId } = req.body;

        if (!planId || !accountType || !txId || !req.file) {
            return res.status(400).json({
                success: false,
                error: 'All fields + screenshot required'
            });
        }

        const plan = await Plan.findOne({ planId: parseInt(planId) });
        if (!plan) {
            return res.status(400).json({ success: false, error: 'Invalid plan' });
        }

        const user = await User.findById(req.userId);

        const transaction = new Transaction({
            userId: req.userId,
            username: user.username,
            type: 'deposit',
            amount: plan.amount,
            accountType,
            screenshot: req.file.path,
            txId,
            planId: plan.planId,
            status: 'pending'
        });

        await transaction.save();

        res.json({
            success: true,
            message: 'Deposit submitted! Waiting for approval.',
            transactionId: transaction._id
        });

    } catch (error) {
        console.error('Deposit error:', error.message);
        res.status(500).json({ success: false, error: 'Deposit failed' });
    }
});

// Submit Withdrawal
app.post('/api/withdraw', authenticateToken, async (req, res) => {
    try {
        const { accountType, accountNumber, accountTitle, amount } = req.body;
        const withdrawAmount = parseFloat(amount);

        if (!accountType || !accountNumber || !accountTitle || !withdrawAmount) {
            return res.status(400).json({ success: false, error: 'All fields required' });
        }

        const user = await User.findById(req.userId);

        if (!user.activePlan?.planId) {
            return res.status(400).json({ success: false, error: 'No active plan. Invest first!' });
        }

        if (user.balance < withdrawAmount) {
            return res.status(400).json({ success: false, error: 'Insufficient balance' });
        }

        const minWD = await Setting.findOne({ key: 'minWithdraw' });
        if (withdrawAmount < (minWD?.value || 30)) {
            return res.status(400).json({ success: false, error: `Min: PKR ${minWD?.value || 30}` });
        }

        const transaction = new Transaction({
            userId: req.userId,
            username: user.username,
            type: 'withdraw',
            amount: withdrawAmount,
            accountType,
            accountNumber,
            accountTitle,
            status: 'pending'
        });

        await transaction.save();

        res.json({
            success: true,
            message: 'Withdrawal submitted! Waiting for approval.'
        });

    } catch (error) {
        console.error('Withdrawal error:', error.message);
        res.status(500).json({ success: false, error: 'Withdrawal failed' });
    }
});

// Get Transactions
app.get('/api/transactions', authenticateToken, async (req, res) => {
    try {
        const transactions = await Transaction.find({ userId: req.userId })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error loading transactions' });
    }
});

// Get Deposits
app.get('/api/deposits', authenticateToken, async (req, res) => {
    try {
        const deposits = await Transaction.find({
            userId: req.userId,
            type: 'deposit'
        }).sort({ createdAt: -1 }).limit(50).lean();
        res.json({ success: true, deposits });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error loading deposits' });
    }
});

// Get Withdrawals
app.get('/api/withdrawals', authenticateToken, async (req, res) => {
    try {
        const withdrawals = await Transaction.find({
            userId: req.userId,
            type: 'withdraw'
        }).sort({ createdAt: -1 }).limit(50).lean();
        res.json({ success: true, withdrawals });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error loading withdrawals' });
    }
});

// Get Team
app.get('/api/team', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const team = await User.find({ referredBy: user.referralCode })
            .select('username totalInvested totalEarned createdAt')
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, teamCount: team.length, team });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error loading team' });
    }
});

// Get Leaderboard
app.get('/api/leaderboard', authenticateToken, async (req, res) => {
    try {
        const topInvestors = await User.find({ status: 'active' })
            .sort({ totalInvested: -1 })
            .limit(10)
            .select('username totalInvested')
            .lean();

        const topReferrers = await User.aggregate([
            { $match: { status: 'active' } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referralCode',
                    foreignField: 'referredBy',
                    as: 'refs'
                }
            },
            { $project: { username: 1, count: { $size: '$refs' } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        res.json({ success: true, topInvestors, topReferrers });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error loading leaderboard' });
    }
});

// Get FAQs
app.get('/api/faqs', async (req, res) => {
    try {
        const faqs = await FAQ.find().sort({ order: 1 }).lean();
        res.json({ success: true, faqs });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error loading FAQs' });
    }
});

// ============================================================
// DAILY PROFIT CRON JOB
// ============================================================

cron.schedule('0 0 * * *', async () => {
    console.log('🕛 Running daily profit distribution...');

    try {
        const users = await User.find({
            'activePlan.planId': { $exists: true },
            'activePlan.endDate': { $gte: new Date() },
            'activePlan.profitDays': { $lt: 60 },
            status: 'active'
        });

        let count = 0;

        for (const user of users) {
            if (user.activePlan && user.activePlan.profitDays < 60) {
                const profit = user.activePlan.dailyProfit;
                user.balance += profit;
                user.totalEarned += profit;
                user.activePlan.profitDays += 1;
                await user.save();

                await new Transaction({
                    userId: user._id,
                    username: user.username,
                    type: 'profit',
                    amount: profit,
                    status: 'approved'
                }).save();

                count++;
            }
        }

        console.log(`✅ Profit distributed to ${count} users`);

    } catch (error) {
        console.error('❌ Profit error:', error.message);
    }
});

console.log('⏰ Daily profit cron scheduled');

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {
    try {
        // Plans
        if (await Plan.countDocuments() === 0) {
            await Plan.insertMany([
                { planId: 1, name: 'Starter', amount: 360, dailyProfit: 11, duration: 60 },
                { planId: 2, name: 'Silver', amount: 860, dailyProfit: 11, duration: 60 },
                { planId: 3, name: 'Gold', amount: 1460, dailyProfit: 11, duration: 60 },
                { planId: 4, name: 'Platinum', amount: 2660, dailyProfit: 11, duration: 60 },
                { planId: 5, name: 'Diamond', amount: 4260, dailyProfit: 11, duration: 60 },
                { planId: 6, name: 'Ruby', amount: 6060, dailyProfit: 11, duration: 60 },
                { planId: 7, name: 'Emerald', amount: 9060, dailyProfit: 11, duration: 60 },
                { planId: 8, name: 'Sapphire', amount: 14060, dailyProfit: 11, duration: 60 },
                { planId: 9, name: 'Titanium', amount: 21060, dailyProfit: 11, duration: 60 },
                { planId: 10, name: 'Master', amount: 30000, dailyProfit: 11, duration: 60 },
                { planId: 11, name: 'Custom', amount: 50000, dailyProfit: 11, duration: 60 }
            ]);
            console.log('✅ Plans initialized');
        }

        // Settings
        if (await Setting.countDocuments() === 0) {
            await Setting.insertMany([
                { key: 'referralBonus', value: 11 },
                { key: 'minWithdraw', value: 30 },
                { key: 'maxWithdraw', value: 500000 },
                { key: 'maxDailyWithdraw', value: 100000 },
                { key: 'easypaisaNumber', value: '03001234567' },
                { key: 'easypaisaTitle', value: 'Muhammad Ali' },
                { key: 'jazzcashNumber', value: '03009876543' },
                { key: 'jazzcashTitle', value: 'Muhammad Ali' }
            ]);
            console.log('✅ Settings initialized');
        }

        // FAQs
        if (await FAQ.countDocuments() === 0) {
            await FAQ.insertMany([
                {
                    question: 'How to invest?',
                    answer: 'Select a plan, send payment to the given account, upload screenshot with Transaction ID.',
                    order: 1
                },
                {
                    question: 'When do I get profit?',
                    answer: 'First profit immediately after deposit approval, then daily at 12:00 AM for 60 days.',
                    order: 2
                },
                {
                    question: 'Minimum withdrawal?',
                    answer: 'PKR 30 minimum withdrawal. Maximum PKR 500,000 per request.',
                    order: 3
                },
                {
                    question: 'How does referral work?',
                    answer: 'Share your unique link. Earn 11% bonus when someone joins and invests!',
                    order: 4
                }
            ]);
            console.log('✅ FAQs initialized');
        }

    } catch (error) {
        console.error('❌ Database init error:', error.message);
    }
}

// ============================================================
// START SERVER
// ============================================================

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/profit24_db';

mongoose.connect(MONGODB_URI)
    .then(async () => {
        console.log('✅ MongoDB connected');
        await initializeDatabase();
        initializeTelegramBot();

        app.listen(PORT, () => {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━');
        });
    })
    .catch(error => {
        console.error('❌ MongoDB connection failed:', error.message);
        process.exit(1);
    });
