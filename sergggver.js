ult: Date.now
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
    }
});

// ============================================================
// CREATE MODELS
// ============================================================
const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Plan = mongoose.model('Plan', planSchema);
const Setting = mongoose.model('Setting', settingSchema);
const FAQ = mongoose.model('FAQ', faqSchema);

console.log('   ✓ Models created');

// ============================================================
// PID GENERATOR FUNCTION
// ============================================================
/**
 * Generates a unique 5-digit PID from WhatsApp number
 * @param {string} whatsapp - User's WhatsApp number
 * @returns {string} - 5-digit PID
 */
function generatePID(whatsapp) {
    var cleaned = whatsapp.replace(/[\s\-\+\(\)]/g, '');
    if (cleaned.length >= 5) {
        return cleaned.slice(-5);
    }
    return cleaned.padStart(5, '0');
}

console.log('   ✓ PID generator ready');

// ============================================================
// TELEGRAM BOT - COMPLETE ADMIN PANEL
// ============================================================
console.log('🤖 Initializing Telegram Bot...');

var bot = null;
var botSessions = {};

/**
 * Initialize Telegram Bot with all admin controls
 */
function initTelegramBot() {
    var botToken = process.env.TELEGRAM_BOT_TOKEN;
    var adminId = process.env.TELEGRAM_ADMIN_ID;

    // Validate configuration
    if (!botToken || botToken === 'your_bot_token_here') {
        console.log('⚠️  Telegram Bot: No token provided. Skipping...');
        return;
    }

    if (!adminId) {
        console.log('⚠️  Telegram Bot: No admin ID provided. Skipping...');
        return;
    }

    console.log('   Token: ' + botToken.substring(0, 10) + '...');
    console.log('   Admin ID: ' + adminId);

    try {
        // Create bot instance
        bot = new TelegramBot(botToken, {
            polling: true,
            filepath: false
        });

        console.log('✅ Telegram Bot: Connected successfully!');

    } catch (error) {
        console.error('❌ Telegram Bot: Failed to connect -', error.message);
        return;
    }

    // ============================================================
    // MAIN MENU KEYBOARD
    // ============================================================
    function getMainMenuKeyboard() {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 Dashboard Statistics', callback_data: 'admin_dashboard' }],
                    [
                        { text: '👥 Users List', callback_data: 'admin_users' },
                        { text: '💰 Pending Deposits', callback_data: 'admin_deposits' }
                    ],
                    [
                        { text: '💸 Pending Withdrawals', callback_data: 'admin_withdrawals' },
                        { text: '📋 Manage Plans', callback_data: 'admin_plans' }
                    ],
                    [
                        { text: '🔄 Fund Transfer Settings', callback_data: 'admin_fundtransfer' },
                        { text: '🏦 Payment Accounts', callback_data: 'admin_accounts' }
                    ],
                    [
                        { text: '⚙️ System Settings', callback_data: 'admin_settings' },
                        { text: '🔗 Referral Settings', callback_data: 'admin_referral' }
                    ],
                    [
                        { text: '❓ FAQ Management', callback_data: 'admin_faq' },
                        { text: '📢 Broadcast Message', callback_data: 'admin_broadcast' }
                    ],
                    [{ text: '🔍 Search User', callback_data: 'admin_search' }]
                ]
            }
        };
    }

    // ============================================================
    // HANDLE /start AND /admin COMMANDS
    // ============================================================
    bot.onText(/\/start|\/admin/, function (msg) {
        var chatId = msg.chat.id.toString();

        // Verify admin
        if (chatId !== adminId) {
            bot.sendMessage(chatId, '⛔ *Access Denied!*\n\nYou are not authorized to use this admin panel.', {
                parse_mode: 'Markdown'
            });
            return;
        }

        var welcomeMessage = '🔐 *ADMIN CONTROL PANEL*\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            'Welcome to the Profit 24 Admin Panel!\n\n' +
            '📊 *Dashboard* - View platform statistics\n' +
            '👥 *Users* - View all registered users\n' +
            '💰 *Deposits* - Approve or reject deposit requests\n' +
            '💸 *Withdrawals* - Process withdrawal requests\n' +
            '📋 *Plans* - Add, delete, or toggle investment plans\n' +
            '🔄 *Fund Transfer* - Enable/disable & set fees\n' +
            '🏦 *Accounts* - Update Easypaisa/JazzCash numbers\n' +
            '⚙️ *Settings* - Configure withdrawal limits\n' +
            '🔗 *Referral* - Set referral bonus percentage\n' +
            '❓ *FAQ* - Manage frequently asked questions\n' +
            '📢 *Broadcast* - Send message to all users\n' +
            '🔍 *Search* - Find user by username or PID\n\n' +
            '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
            'Select an option below to continue:';

        bot.sendMessage(adminId, welcomeMessage, {
            parse_mode: 'Markdown',
            ...getMainMenuKeyboard()
        });
    });

    // ============================================================
    // HANDLE ALL CALLBACK QUERIES (BUTTON CLICKS)
    // ============================================================
    bot.on('callback_query', async function (query) {
        var chatId = query.message.chat.id.toString();

        // Verify admin
        if (chatId !== adminId) {
            bot.answerCallbackQuery(query.id, { text: '⛔ Unauthorized!' });
            return;
        }

        var action = query.data;
        await bot.answerCallbackQuery(query.id);

        console.log('Bot action:', action);

        try {
            // =====================================================
            // DASHBOARD
            // =====================================================
            if (action === 'admin_dashboard') {
                var totalUsers = await User.countDocuments();
                var usersWithPlans = await User.countDocuments({
                    'activePlans.0': { $exists: true },
                    status: 'active'
                });
                var blockedUsers = await User.countDocuments({ status: 'blocked' });
                var pendingDeposits = await Transaction.countDocuments({
                    type: 'deposit',
                    status: 'pending'
                });
                var pendingWithdrawals = await Transaction.countDocuments({
                    type: 'withdraw',
                    status: 'pending'
                });

                // Calculate totals
                var totalDepositsResult = await Transaction.aggregate([
                    { $match: { type: 'deposit', status: 'approved' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);

                var totalWithdrawalsResult = await Transaction.aggregate([
                    { $match: { type: 'withdraw', status: 'approved' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);

                var totalTransferResult = await Transaction.aggregate([
                    { $match: { type: 'transfer_sent', status: 'completed' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);

                // Today's profit
                var today = new Date();
                today.setHours(0, 0, 0, 0);
                var todayProfitResult = await Transaction.aggregate([
                    {
                        $match: {
                            type: 'profit',
                            status: 'approved',
                            createdAt: { $gte: today }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: '$amount' },
                            count: { $sum: 1 }
                        }
                    }
                ]);

                // System status
                var depositEnabled = await Setting.findOne({ key: 'depositEnabled' });
                var withdrawEnabled = await Setting.findOne({ key: 'withdrawEnabled' });
                var transferEnabled = await Setting.findOne({ key: 'fundTransferEnabled' });
                var transferFee = await Setting.findOne({ key: 'fundTransferFee' });

                var dashboardMessage = '📊 *DASHBOARD STATISTICS*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '👥 *Users*\n' +
                    '   • Total: ' + totalUsers + '\n' +
                    '   • With Plans: ' + usersWithPlans + '\n' +
                    '   • Blocked: ' + blockedUsers + '\n\n' +
                    '💰 *Finance*\n' +
                    '   • Total Deposits: PKR ' + (totalDepositsResult[0]?.total || 0).toLocaleString() + '\n' +
                    '   • Total Withdrawals: PKR ' + (totalWithdrawalsResult[0]?.total || 0).toLocaleString() + '\n' +
                    '   • Total Transfers: PKR ' + (totalTransferResult[0]?.total || 0).toLocaleString() + '\n' +
                    '   • Today\'s Profit: PKR ' + (todayProfitResult[0]?.total || 0).toLocaleString() + '\n' +
                    '   • Profit Given: ' + (todayProfitResult[0]?.count || 0) + ' times\n\n' +
                    '⏳ *Pending*\n' +
                    '   • Deposits: ' + pendingDeposits + '\n' +
                    '   • Withdrawals: ' + pendingWithdrawals + '\n\n' +
                    '⚙️ *System Status*\n' +
                    '   • Deposits: ' + (depositEnabled?.value !== false ? '✅ Enabled' : '❌ Disabled') + '\n' +
                    '   • Withdrawals: ' + (withdrawEnabled?.value !== false ? '✅ Enabled' : '❌ Disabled') + '\n' +
                    '   • Transfers: ' + (transferEnabled?.value !== false ? '✅ Enabled' : '❌ Disabled') + '\n' +
                    '   • Transfer Fee: ' + (transferFee?.value || 0) + '%\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n' +
                    '📅 ' + new Date().toLocaleString();

                await bot.editMessageText(dashboardMessage, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    ...getMainMenuKeyboard()
                });
            }

            // =====================================================
            // USERS LIST
            // =====================================================
            else if (action === 'admin_users') {
                var users = await User.find()
                    .sort({ createdAt: -1 })
                    .limit(25)
                    .lean();

                var totalCount = await User.countDocuments();

                var message = '👥 *ALL USERS* (' + totalCount + ' total)\n\n';
                message += '━━━━━━━━━━━━━━━━━━━━━━\n\n';

                users.forEach(function (user, index) {
                    var statusIcon = user.status === 'blocked' ? '🔴' : '🟢';
                    var plansCount = user.activePlans ? user.activePlans.length : 0;
                    var plansText = plansCount > 0 ? ' (' + plansCount + ' plans)' : '';

                    message += (index + 1) + '. ' + statusIcon + ' *' + user.username + '*\n';
                    message += '   🆔 PID: ' + user.pid + '\n';
                    message += '   💰 Balance: PKR ' + (user.balance || 0).toFixed(2) + '\n';
                    message += '   📋 Plans: ' + plansCount + plansText + '\n';
                    message += '   📅 Joined: ' + new Date(user.createdAt).toLocaleDateString() + '\n\n';
                });

                message += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
                message += '🔍 Use Search to find a specific user.';

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    ...getMainMenuKeyboard()
                });
            }

            // =====================================================
            // PENDING DEPOSITS
            // =====================================================
            else if (action === 'admin_deposits') {
                await showPendingTransactions('deposit', chatId, query.message.message_id);
            }

            // =====================================================
            // PENDING WITHDRAWALS
            // =====================================================
            else if (action === 'admin_withdrawals') {
                await showPendingTransactions('withdraw', chatId, query.message.message_id);
            }

            // =====================================================
            // MANAGE PLANS
            // =====================================================
            else if (action === 'admin_plans') {
                var plans = await Plan.find().sort({ planId: 1 }).lean();

                var message = '📋 *INVESTMENT PLANS*\n\n';
                message += '━━━━━━━━━━━━━━━━━━━━━━\n\n';

                plans.forEach(function (plan) {
                    var statusIcon = plan.isActive ? '✅' : '❌';
                    var totalReturn = plan.amount * (plan.dailyProfit / 100) * plan.duration;

                    message += statusIcon + ' *Plan ' + plan.planId + ': ' + plan.name + '*\n';
                    message += '   💰 Amount: PKR ' + plan.amount.toLocaleString() + '\n';
                    message += '   📈 Daily Profit: ' + plan.dailyProfit + '%\n';
                    message += '   📅 Duration: ' + plan.duration + ' Days\n';
                    message += '   💎 Total Return: PKR ' + totalReturn.toLocaleString() + '\n\n';
                });

                message += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
                message += 'Select an action:';

                var planKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '➕ ADD NEW PLAN', callback_data: 'plan_add' }
                            ],
                            [
                                { text: '🗑️ DELETE PLAN', callback_data: 'plan_delete_select' },
                                { text: '🔄 TOGGLE PLAN', callback_data: 'plan_toggle_select' }
                            ],
                            [
                                { text: '🔙 BACK TO MENU', callback_data: 'admin_dashboard' }
                            ]
                        ]
                    }
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    ...planKeyboard
                });
            }

            // =====================================================
            // ADD PLAN - Prompt
            // =====================================================
            else if (action === 'plan_add') {
                botSessions[chatId] = { step: 'adding_plan' };

                var instructions = '➕ *ADD NEW INVESTMENT PLAN*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    'Please send the plan details in this format:\n\n' +
                    '*Plan Name | Amount | Profit % | Duration Days*\n\n' +
                    'Example:\n' +
                    '`Premium Plan | 10000 | 12 | 60`\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '• Plan Name: Any name\n' +
                    '• Amount: PKR amount\n' +
                    '• Profit %: Daily profit percentage\n' +
                    '• Duration Days: Number of days\n\n' +
                    'Send `/cancel` to abort.';

                await bot.sendMessage(chatId, instructions, { parse_mode: 'Markdown' });
            }

            // =====================================================
            // DELETE PLAN - Select
            // =====================================================
            else if (action === 'plan_delete_select') {
                var plans = await Plan.find().sort({ planId: 1 }).lean();

                var deleteButtons = plans.map(function (plan) {
                    return [{
                        text: '🗑️ Plan ' + plan.planId + ': ' + plan.name + ' (PKR ' + plan.amount.toLocaleString() + ')',
                        callback_data: 'plan_delete_' + plan.planId
                    }];
                });

                deleteButtons.push([{ text: '🔙 Back', callback_data: 'admin_plans' }]);

                await bot.editMessageText('🗑️ *DELETE PLAN*\n\nSelect a plan to delete:', {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: deleteButtons }
                });
            }

            // =====================================================
            // TOGGLE PLAN - Select
            // =====================================================
            else if (action === 'plan_toggle_select') {
                var plans = await Plan.find().sort({ planId: 1 }).lean();

                var toggleButtons = plans.map(function (plan) {
                    return [{
                        text: (plan.isActive ? '✅' : '❌') + ' Plan ' + plan.planId + ': ' + plan.name,
                        callback_data: 'plan_toggle_' + plan.planId
                    }];
                });

                toggleButtons.push([{ text: '🔙 Back', callback_data: 'admin_plans' }]);

                await bot.editMessageText('🔄 *TOGGLE PLAN*\n\nSelect a plan to enable/disable:', {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: toggleButtons }
                });
            }

            // =====================================================
            // EXECUTE DELETE PLAN
            // =====================================================
            else if (action.startsWith('plan_delete_')) {
                var planId = parseInt(action.replace('plan_delete_', ''));
                var plan = await Plan.findOne({ planId: planId });

                if (!plan) {
                    await bot.sendMessage(chatId, '❌ Plan not found!');
                    return;
                }

                await Plan.deleteOne({ planId: planId });

                await bot.sendMessage(chatId,
                    '✅ *Plan Deleted!*\n\n' +
                    'Plan ID: ' + planId + '\n' +
                    'Name: ' + plan.name + '\n' +
                    'Amount: PKR ' + plan.amount.toLocaleString(),
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
            }

            // =====================================================
            // EXECUTE TOGGLE PLAN
            // =====================================================
            else if (action.startsWith('plan_toggle_')) {
                var planId = parseInt(action.replace('plan_toggle_', ''));
                var plan = await Plan.findOne({ planId: planId });

                if (!plan) {
                    await bot.sendMessage(chatId, '❌ Plan not found!');
                    return;
                }

                plan.isActive = !plan.isActive;
                await plan.save();

                var statusText = plan.isActive ? '✅ ACTIVE' : '❌ INACTIVE';

                await bot.sendMessage(chatId,
                    '✅ *Plan Status Updated!*\n\n' +
                    'Plan: ' + plan.name + '\n' +
                    'Status: ' + statusText,
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
            }

            // =====================================================
            // FUND TRANSFER SETTINGS
            // =====================================================
            else if (action === 'admin_fundtransfer') {
                var transferEnabled = await Setting.findOne({ key: 'fundTransferEnabled' });
                var transferFee = await Setting.findOne({ key: 'fundTransferFee' });

                var message = '🔄 *FUND TRANSFER SETTINGS*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    'Status: ' + (transferEnabled?.value !== false ? '✅ Enabled' : '❌ Disabled') + '\n' +
                    'Fee: ' + (transferFee?.value || 0) + '%\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    'Select an action:';

                var keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{
                                text: (transferEnabled?.value !== false ? '❌ Disable Transfer' : '✅ Enable Transfer'),
                                callback_data: 'ft_toggle'
                            }],
                            [{ text: '💰 Set Fee Percentage', callback_data: 'ft_setfee' }],
                            [{ text: '🔙 Back to Menu', callback_data: 'admin_dashboard' }]
                        ]
                    }
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    ...keyboard
                });
            }

            // =====================================================
            // TOGGLE FUND TRANSFER
            // =====================================================
            else if (action === 'ft_toggle') {
                var currentSetting = await Setting.findOne({ key: 'fundTransferEnabled' });
                var newValue = currentSetting?.value !== false ? false : true;

                await Setting.findOneAndUpdate(
                    { key: 'fundTransferEnabled' },
                    { value: newValue, updatedAt: new Date() },
                    { upsert: true }
                );

                await bot.sendMessage(chatId,
                    '✅ Fund Transfer is now *' + (newValue ? 'ENABLED' : 'DISABLED') + '*',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
            }

            // =====================================================
            // SET TRANSFER FEE - Prompt
            // =====================================================
            else if (action === 'ft_setfee') {
                botSessions[chatId] = { step: 'setting_transfer_fee' };

                await bot.sendMessage(chatId,
                    '💰 *SET TRANSFER FEE*\n\n' +
                    'Send the fee percentage (0-100):\n\n' +
                    'Example: `2` for 2% fee\n\n' +
                    'Send `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // PAYMENT ACCOUNTS
            // =====================================================
            else if (action === 'admin_accounts') {
                var easypaisaNumber = await Setting.findOne({ key: 'easypaisaNumber' });
                var easypaisaTitle = await Setting.findOne({ key: 'easypaisaTitle' });
                var jazzcashNumber = await Setting.findOne({ key: 'jazzcashNumber' });
                var jazzcashTitle = await Setting.findOne({ key: 'jazzcashTitle' });

                var message = '🏦 *PAYMENT ACCOUNTS*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '*Easypaisa:*\n' +
                    '📱 Number: `' + (easypaisaNumber?.value || 'Not Set') + '`\n' +
                    '📛 Title: ' + (easypaisaTitle?.value || 'Not Set') + '\n\n' +
                    '*JazzCash:*\n' +
                    '📱 Number: `' + (jazzcashNumber?.value || 'Not Set') + '`\n' +
                    '📛 Title: ' + (jazzcashTitle?.value || 'Not Set') + '\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    'Click below to update:';

                var keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📱 Update Easypaisa', callback_data: 'acc_setep' }],
                            [{ text: '💼 Update JazzCash', callback_data: 'acc_setjc' }],
                            [{ text: '🔙 Back to Menu', callback_data: 'admin_dashboard' }]
                        ]
                    }
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    ...keyboard
                });
            }

            // =====================================================
            // UPDATE EASYPAISA - Prompt
            // =====================================================
            else if (action === 'acc_setep') {
                botSessions[chatId] = { step: 'setting_easypaisa' };

                await bot.sendMessage(chatId,
                    '📱 *UPDATE EASYPAISA*\n\n' +
                    'Send: Number | Title\n\n' +
                    'Example:\n' +
                    '`03001234567 | Muhammad Ali`\n\n' +
                    'Send `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // UPDATE JAZZCASH - Prompt
            // =====================================================
            else if (action === 'acc_setjc') {
                botSessions[chatId] = { step: 'setting_jazzcash' };

                await bot.sendMessage(chatId,
                    '💼 *UPDATE JAZZCASH*\n\n' +
                    'Send: Number | Title\n\n' +
                    'Example:\n' +
                    '`03009876543 | Muhammad Ali`\n\n' +
                    'Send `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // SYSTEM SETTINGS
            // =====================================================
            else if (action === 'admin_settings') {
                var minWithdraw = await Setting.findOne({ key: 'minWithdraw' });
                var maxWithdraw = await Setting.findOne({ key: 'maxWithdraw' });
                var maxDaily = await Setting.findOne({ key: 'maxDailyWithdraw' });
                var depositEnabled = await Setting.findOne({ key: 'depositEnabled' });
                var withdrawEnabled = await Setting.findOne({ key: 'withdrawEnabled' });

                var message = '⚙️ *SYSTEM SETTINGS*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '*Withdrawal Limits:*\n' +
                    '• Minimum: PKR ' + (minWithdraw?.value || 30).toLocaleString() + '\n' +
                    '• Maximum: PKR ' + (maxWithdraw?.value || 500000).toLocaleString() + '\n' +
                    '• Daily Limit: PKR ' + (maxDaily?.value || 100000).toLocaleString() + '\n\n' +
                    '*System Status:*\n' +
                    '• Deposits: ' + (depositEnabled?.value !== false ? '✅ Enabled' : '❌ Disabled') + '\n' +
                    '• Withdrawals: ' + (withdrawEnabled?.value !== false ? '✅ Enabled' : '❌ Disabled') + '\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    'Select a setting to update:';

                var keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📝 Set Min Withdrawal', callback_data: 'set_minwd' },
                                { text: '📝 Set Max Withdrawal', callback_data: 'set_maxwd' }
                            ],
                            [{ text: '📝 Set Daily Limit', callback_data: 'set_dailywd' }],
                            [
                                {
                                    text: (depositEnabled?.value !== false ? '❌ Disable Deposits' : '✅ Enable Deposits'),
                                    callback_data: 'toggle_deposit'
                                }
                            ],
                            [
                                {
                                    text: (withdrawEnabled?.value !== false ? '❌ Disable Withdrawals' : '✅ Enable Withdrawals'),
                                    callback_data: 'toggle_withdraw'
                                }
                            ],
                            [{ text: '🔙 Back to Menu', callback_data: 'admin_dashboard' }]
                        ]
                    }
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    ...keyboard
                });
            }

            // =====================================================
            // SET MIN WITHDRAWAL - Prompt
            // =====================================================
            else if (action === 'set_minwd') {
                botSessions[chatId] = { step: 'setting_minwd' };
                await bot.sendMessage(chatId,
                    '📝 Send the minimum withdrawal amount in PKR:\n\nSend `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // SET MAX WITHDRAWAL - Prompt
            // =====================================================
            else if (action === 'set_maxwd') {
                botSessions[chatId] = { step: 'setting_maxwd' };
                await bot.sendMessage(chatId,
                    '📝 Send the maximum withdrawal amount in PKR:\n\nSend `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // SET DAILY LIMIT - Prompt
            // =====================================================
            else if (action === 'set_dailywd') {
                botSessions[chatId] = { step: 'setting_dailywd' };
                await bot.sendMessage(chatId,
                    '📝 Send the daily withdrawal limit in PKR:\n\nSend `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // TOGGLE DEPOSIT ENABLE/DISABLE
            // =====================================================
            else if (action === 'toggle_deposit') {
                var currentSetting = await Setting.findOne({ key: 'depositEnabled' });
                var newValue = currentSetting?.value !== false ? false : true;

                await Setting.findOneAndUpdate(
                    { key: 'depositEnabled' },
                    { value: newValue, updatedAt: new Date() },
                    { upsert: true }
                );

                await bot.sendMessage(chatId,
                    '✅ Deposits are now *' + (newValue ? 'ENABLED' : 'DISABLED') + '*',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
            }

            // =====================================================
            // TOGGLE WITHDRAWAL ENABLE/DISABLE
            // =====================================================
            else if (action === 'toggle_withdraw') {
                var currentSetting = await Setting.findOne({ key: 'withdrawEnabled' });
                var newValue = currentSetting?.value !== false ? false : true;

                await Setting.findOneAndUpdate(
                    { key: 'withdrawEnabled' },
                    { value: newValue, updatedAt: new Date() },
                    { upsert: true }
                );

                await bot.sendMessage(chatId,
                    '✅ Withdrawals are now *' + (newValue ? 'ENABLED' : 'DISABLED') + '*',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
            }

            // =====================================================
            // REFERRAL SETTINGS
            // =====================================================
            else if (action === 'admin_referral') {
                var referralBonus = await Setting.findOne({ key: 'referralBonus' });

                var message = '🔗 *REFERRAL SETTINGS*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    'Current Referral Bonus: *' + (referralBonus?.value || 11) + '%*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    'Click below to change:';

                var keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📝 Change Bonus Percentage', callback_data: 'set_refbonus' }],
                            [{ text: '🔙 Back to Menu', callback_data: 'admin_dashboard' }]
                        ]
                    }
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    ...keyboard
                });
            }

            // =====================================================
            // SET REFERRAL BONUS - Prompt
            // =====================================================
            else if (action === 'set_refbonus') {
                botSessions[chatId] = { step: 'setting_refbonus' };
                await bot.sendMessage(chatId,
                    '📝 Send the referral bonus percentage (0-100):\n\nSend `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // FAQ MANAGEMENT
            // =====================================================
            else if (action === 'admin_faq') {
                var faqs = await FAQ.find().sort({ order: 1 }).lean();

                var message = '❓ *FAQ MANAGEMENT*\n\n';
                message += '━━━━━━━━━━━━━━━━━━━━━━\n\n';

                if (faqs.length === 0) {
                    message += 'No FAQs available.\n\n';
                } else {
                    faqs.forEach(function (faq, index) {
                        message += (index + 1) + '. *Q:* ' + faq.question + '\n';
                        message += '   *A:* ' + faq.answer + '\n\n';
                    });
                }

                message += '━━━━━━━━━━━━━━━━━━━━━━\n\n';
                message += 'Total FAQs: ' + faqs.length;

                var keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ Add New FAQ', callback_data: 'faq_add' }],
                            [{ text: '🗑️ Delete All FAQs', callback_data: 'faq_clear' }],
                            [{ text: '🔙 Back to Menu', callback_data: 'admin_dashboard' }]
                        ]
                    }
                };

                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'Markdown',
                    ...keyboard
                });
            }

            // =====================================================
            // ADD FAQ - Prompt
            // =====================================================
            else if (action === 'faq_add') {
                botSessions[chatId] = { step: 'adding_faq' };

                await bot.sendMessage(chatId,
                    '❓ *ADD FAQ*\n\n' +
                    'Send: Question | Answer\n\n' +
                    'Example:\n' +
                    '`How to invest? | Select a plan and make payment`\n\n' +
                    'Send `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // CLEAR ALL FAQS
            // =====================================================
            else if (action === 'faq_clear') {
                await FAQ.deleteMany({});
                await bot.sendMessage(chatId,
                    '✅ All FAQs have been deleted!',
                    { ...getMainMenuKeyboard() }
                );
            }

            // =====================================================
            // BROADCAST - Prompt
            // =====================================================
            else if (action === 'admin_broadcast') {
                botSessions[chatId] = { step: 'broadcasting' };

                await bot.sendMessage(chatId,
                    '📢 *BROADCAST MESSAGE*\n\n' +
                    'Send the message you want to broadcast to all active users.\n\n' +
                    'Send `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // SEARCH USER - Prompt
            // =====================================================
            else if (action === 'admin_search') {
                botSessions[chatId] = { step: 'searching_user' };

                await bot.sendMessage(chatId,
                    '🔍 *SEARCH USER*\n\n' +
                    'Send the username or PID to find:\n\n' +
                    'Send `/cancel` to abort.',
                    { parse_mode: 'Markdown' }
                );
            }

            // =====================================================
            // APPROVE DEPOSIT
            // =====================================================
            else if (action.startsWith('approve_deposit_')) {
                var transactionId = action.replace('approve_deposit_', '');
                await processDepositAction(transactionId, 'approved', chatId);
            }

            // =====================================================
            // REJECT DEPOSIT
            // =====================================================
            else if (action.startsWith('reject_deposit_')) {
                var transactionId = action.replace('reject_deposit_', '');
                await processDepositAction(transactionId, 'rejected', chatId);
            }

            // =====================================================
            // APPROVE WITHDRAWAL
            // =====================================================
            else if (action.startsWith('approve_withdrawal_')) {
                var transactionId = action.replace('approve_withdrawal_', '');
                await processWithdrawalAction(transactionId, 'approved', chatId);
            }

            // =====================================================
            // REJECT WITHDRAWAL
            // =====================================================
            else if (action.startsWith('reject_withdrawal_')) {
                var transactionId = action.replace('reject_withdrawal_', '');
                await processWithdrawalAction(transactionId, 'rejected', chatId);
            }

            // =====================================================
            // TOGGLE USER BLOCK/UNBLOCK
            // =====================================================
            else if (action.startsWith('user_toggle_')) {
                var username = action.replace('user_toggle_', '');
                var user = await User.findOne({ username: username });

                if (!user) {
                    await bot.sendMessage(chatId, '❌ User not found!');
                    return;
                }

                user.status = user.status === 'active' ? 'blocked' : 'active';
                await user.save();

                var newStatus = user.status === 'active' ? '🟢 Active' : '🔴 Blocked';

                await bot.sendMessage(chatId,
                    '✅ *User Status Updated!*\n\n' +
                    'Username: ' + user.username + '\n' +
                    'Status: ' + newStatus,
                    { parse_mode: 'Markdown' }
                );
            }

        } catch (error) {
            console.error('Bot callback error:', error.message);
            await bot.sendMessage(chatId,
                '❌ Error: ' + error.message,
                { ...getMainMenuKeyboard() }
            );
        }
    });

    // ============================================================
    // HANDLE TEXT MESSAGES FOR MULTI-STEP OPERATIONS
    // ============================================================
    bot.on('message', async function (msg) {
        var chatId = msg.chat.id.toString();

        // Only process admin messages
        if (chatId !== adminId) return;

        // Only process text messages
        if (!msg.text) return;

        var text = msg.text.trim();
        var session = botSessions[chatId];

        // Cancel any operation
        if (text === '/cancel') {
            if (session) {
                delete botSessions[chatId];
                await bot.sendMessage(chatId,
                    '❌ Operation cancelled.',
                    { ...getMainMenuKeyboard() }
                );
            }
            return;
        }

        // Handle different session types
        if (session) {
            // =====================================================
            // ADDING PLAN
            // =====================================================
            if (session.step === 'adding_plan') {
                var parts = text.split('|').map(function (part) {
                    return part.trim();
                });

                if (parts.length < 4) {
                    await bot.sendMessage(chatId,
                        '❌ Invalid format!\n\n' +
                        'Please use: Name | Amount | Profit% | Days\n\n' +
                        'Example: Premium | 5000 | 12 | 60'
                    );
                    return;
                }

                var planName = parts[0];
                var planAmount = parseInt(parts[1]);
                var planProfit = parseFloat(parts[2]);
                var planDays = parseInt(parts[3]);

                if (isNaN(planAmount) || isNaN(planProfit) || isNaN(planDays)) {
                    await bot.sendMessage(chatId, '❌ Invalid numbers! Please check your input.');
                    return;
                }

                var lastPlan = await Plan.findOne().sort({ planId: -1 });
                var newPlanId = lastPlan ? lastPlan.planId + 1 : 1;

                await new Plan({
                    planId: newPlanId,
                    name: planName,
                    amount: planAmount,
                    dailyProfit: planProfit,
                    duration: planDays,
                    isActive: true
                }).save();

                delete botSessions[chatId];

                var totalReturn = planAmount * (planProfit / 100) * planDays;

                await bot.sendMessage(chatId,
                    '✅ *PLAN ADDED SUCCESSFULLY!*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '📋 Plan ID: ' + newPlanId + '\n' +
                    '📛 Name: ' + planName + '\n' +
                    '💰 Amount: PKR ' + planAmount.toLocaleString() + '\n' +
                    '📈 Daily Profit: ' + planProfit + '%\n' +
                    '📅 Duration: ' + planDays + ' Days\n' +
                    '💎 Total Return: PKR ' + totalReturn.toLocaleString() + '\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // SETTING TRANSFER FEE
            // =====================================================
            if (session.step === 'setting_transfer_fee') {
                var feeValue = parseFloat(text);

                if (isNaN(feeValue) || feeValue < 0 || feeValue > 100) {
                    await bot.sendMessage(chatId, '❌ Invalid! Enter a number between 0 and 100.');
                    return;
                }

                await Setting.findOneAndUpdate(
                    { key: 'fundTransferFee' },
                    { value: feeValue, updatedAt: new Date() },
                    { upsert: true }
                );

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ Transfer fee set to *' + feeValue + '%*',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // SETTING EASYPAISA
            // =====================================================
            if (session.step === 'setting_easypaisa') {
                var parts = text.split('|').map(function (part) {
                    return part.trim();
                });

                if (parts.length < 2) {
                    await bot.sendMessage(chatId, '❌ Format: Number | Title\nExample: 03001234567 | Ali');
                    return;
                }

                await Setting.findOneAndUpdate(
                    { key: 'easypaisaNumber' },
                    { value: parts[0], updatedAt: new Date() },
                    { upsert: true }
                );
                await Setting.findOneAndUpdate(
                    { key: 'easypaisaTitle' },
                    { value: parts[1], updatedAt: new Date() },
                    { upsert: true }
                );

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ *Easypaisa Updated!*\n\n📱 Number: `' + parts[0] + '`\n📛 Title: ' + parts[1],
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // SETTING JAZZCASH
            // =====================================================
            if (session.step === 'setting_jazzcash') {
                var parts = text.split('|').map(function (part) {
                    return part.trim();
                });

                if (parts.length < 2) {
                    await bot.sendMessage(chatId, '❌ Format: Number | Title\nExample: 03009876543 | Ali');
                    return;
                }

                await Setting.findOneAndUpdate(
                    { key: 'jazzcashNumber' },
                    { value: parts[0], updatedAt: new Date() },
                    { upsert: true }
                );
                await Setting.findOneAndUpdate(
                    { key: 'jazzcashTitle' },
                    { value: parts[1], updatedAt: new Date() },
                    { upsert: true }
                );

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ *JazzCash Updated!*\n\n📱 Number: `' + parts[0] + '`\n📛 Title: ' + parts[1],
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // SETTING MIN WITHDRAWAL
            // =====================================================
            if (session.step === 'setting_minwd') {
                var value = parseInt(text);

                if (isNaN(value) || value < 0) {
                    await bot.sendMessage(chatId, '❌ Invalid amount!');
                    return;
                }

                await Setting.findOneAndUpdate(
                    { key: 'minWithdraw' },
                    { value: value, updatedAt: new Date() },
                    { upsert: true }
                );

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ Minimum withdrawal set to PKR *' + value.toLocaleString() + '*',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // SETTING MAX WITHDRAWAL
            // =====================================================
            if (session.step === 'setting_maxwd') {
                var value = parseInt(text);

                if (isNaN(value) || value < 0) {
                    await bot.sendMessage(chatId, '❌ Invalid amount!');
                    return;
                }

                await Setting.findOneAndUpdate(
                    { key: 'maxWithdraw' },
                    { value: value, updatedAt: new Date() },
                    { upsert: true }
                );

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ Maximum withdrawal set to PKR *' + value.toLocaleString() + '*',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // SETTING DAILY LIMIT
            // =====================================================
            if (session.step === 'setting_dailywd') {
                var value = parseInt(text);

                if (isNaN(value) || value < 0) {
                    await bot.sendMessage(chatId, '❌ Invalid amount!');
                    return;
                }

                await Setting.findOneAndUpdate(
                    { key: 'maxDailyWithdraw' },
                    { value: value, updatedAt: new Date() },
                    { upsert: true }
                );

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ Daily limit set to PKR *' + value.toLocaleString() + '*',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // SETTING REFERRAL BONUS
            // =====================================================
            if (session.step === 'setting_refbonus') {
                var value = parseFloat(text);

                if (isNaN(value) || value < 0 || value > 100) {
                    await bot.sendMessage(chatId, '❌ Invalid! Enter a number between 0 and 100.');
                    return;
                }

                await Setting.findOneAndUpdate(
                    { key: 'referralBonus' },
                    { value: value, updatedAt: new Date() },
                    { upsert: true }
                );

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ Referral bonus set to *' + value + '%*',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // ADDING FAQ
            // =====================================================
            if (session.step === 'adding_faq') {
                var parts = text.split('|').map(function (part) {
                    return part.trim();
                });

                if (parts.length < 2) {
                    await bot.sendMessage(chatId, '❌ Format: Question | Answer');
                    return;
                }

                var faqCount = await FAQ.countDocuments();

                await new FAQ({
                    question: parts[0],
                    answer: parts[1],
                    order: faqCount + 1
                }).save();

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ FAQ added successfully!\n\nTotal FAQs: ' + (faqCount + 1),
                    { ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // BROADCASTING
            // =====================================================
            if (session.step === 'broadcasting') {
                var allUsers = await User.find({ status: 'active' }).lean();

                var progressMsg = await bot.sendMessage(chatId,
                    '📢 Broadcasting to ' + allUsers.length + ' users...\n\n⏳ Please wait...'
                );

                var successCount = 0;
                var failCount = 0;

                for (var i = 0; i < allUsers.length; i++) {
                    try {
                        await bot.sendMessage(
                            allUsers[i]._id,
                            '📢 *MESSAGE FROM ADMIN*\n\n' + text + '\n\n━━━━━━━━━━━━━━\n💎 Profit 24 Platform',
                            { parse_mode: 'Markdown' }
                        );
                        successCount++;
                    } catch (e) {
                        failCount++;
                    }

                    // Small delay to avoid rate limiting
                    await new Promise(function (resolve) {
                        setTimeout(resolve, 50);
                    });
                }

                await bot.deleteMessage(chatId, progressMsg.message_id);

                delete botSessions[chatId];

                await bot.sendMessage(chatId,
                    '✅ *BROADCAST COMPLETED!*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '👥 Total Users: ' + allUsers.length + '\n' +
                    '✅ Sent: ' + successCount + '\n' +
                    '❌ Failed: ' + failCount + '\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━',
                    { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                );
                return;
            }

            // =====================================================
            // SEARCHING USER
            // =====================================================
            if (session.step === 'searching_user') {
                var user = await User.findOne({
                    $or: [
                        { username: text },
                        { pid: text }
                    ]
                }).lean();

                if (!user) {
                    delete botSessions[chatId];
                    await bot.sendMessage(chatId,
                        '❌ User not found with: *' + text + '*',
                        { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
                    );
                    return;
                }

                delete botSessions[chatId];

                var plansInfo = 'None';
                if (user.activePlans && user.activePlans.length > 0) {
                    var planNames = [];
                    user.activePlans.forEach(function (p) {
                        planNames.push(p.name + ' (Day ' + p.profitDays + '/60)');
                    });
                    plansInfo = planNames.join('\n   • ');
                }

                var refCount = await User.countDocuments({ referredBy: user.referralCode });

                var userInfo = '👤 *USER INFORMATION*\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                    '📛 Username: ' + user.username + '\n' +
                    '🆔 PID: ' + user.pid + '\n' +
                    '📱 WhatsApp: ' + user.whatsapp + '\n' +
                    '📊 Status: ' + (user.status === 'active' ? '🟢 Active' : '🔴 Blocked') + '\n\n' +
                    '💰 Balance: PKR ' + (user.balance || 0).toFixed(2) + '\n' +
                    '📋 Plans: ' + (user.activePlans?.length || 0) + '\n' +
                    '   • ' + plansInfo + '\n' +
                    '💵 Invested: PKR ' + (user.totalInvested || 0).toLocaleString() + '\n' +
                    '💎 Earned: PKR ' + (user.totalEarned || 0).toLocaleString() + '\n' +
                    '💸 Withdrawn: PKR ' + (user.totalWithdrawn || 0).toLocaleString() + '\n' +
                    '🎁 Ref Earnings: PKR ' + (user.referralEarnings || 0).toLocaleString() + '\n' +
                    '🔗 Referrals: ' + refCount + '\n' +
                    '📅 Joined: ' + new Date(user.createdAt).toLocaleDateString() + '\n\n' +
                    '━━━━━━━━━━━━━━━━━━━━━━';

                var keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{
                                text: user.status === 'active' ? '🔴 BLOCK USER' : '🟢 UNBLOCK USER',
                                callback_data: 'user_toggle_' + user.username
                            }],
                            [{ text: '🔙 Back to Menu', callback_data: 'admin_dashboard' }]
                        ]
                    }
                };

                await bot.sendMessage(chatId, userInfo, {
                    parse_mode: 'Markdown',
                    ...keyboard
                });
                return;
            }
        }
    });

    console.log('✅ Telegram Bot: All handlers registered');
}

// ============================================================
// HELPER: SHOW PENDING TRANSACTIONS
// ============================================================
async function showPendingTransactions(type, chatId, messageId) {
    var items = await Transaction.find({
        type: type,
        status: 'pending'
    })
        .sort({ createdAt: -1 })
        .limit(15)
        .lean();

    if (!items || items.length === 0) {
        return bot.editMessageText(
            '✅ No pending ' + type + 's at the moment.',
            {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_dashboard' }]]
                }
            }
        );
    }

    await bot.deleteMessage(chatId, messageId);

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var user = await User.findOne({ username: item.username }).lean();
        var prefix = type === 'deposit' ? 'd' : 'w';
        var message = '';

        if (type === 'deposit') {
            message = '💰 *PENDING DEPOSIT*\n\n' +
                '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                '👤 User: ' + item.username + '\n' +
                '🆔 PID: ' + (user?.pid || 'N/A') + '\n' +
                '💵 Amount: PKR ' + item.amount.toLocaleString() + '\n' +
                '📋 Plan: ' + (item.planName || 'Plan ' + item.planId) + '\n' +
                '🏦 Method: ' + item.accountType.toUpperCase() + '\n' +
                '🔢 TxID: `' + item.txId + '`\n' +
                '📅 Date: ' + new Date(item.createdAt).toLocaleString() + '\n\n' +
                '━━━━━━━━━━━━━━━━━━━━━━';
        } else {
            message = '💸 *PENDING WITHDRAWAL*\n\n' +
                '━━━━━━━━━━━━━━━━━━━━━━\n\n' +
                '👤 User: ' + item.username + '\n' +
                '🆔 PID: ' + (user?.pid || 'N/A') + '\n' +
                '💰 Balance: PKR ' + (user?.balance || 0).toFixed(2) + '\n' +
                '💵 Amount: PKR ' + item.amount.toLocaleString() + '\n' +
                '🏦 Method: ' + item.accountType.toUpperCase() + '\n' +
                '🔢 Account: `' + item.accountNumber + '`\n' +
                '📛 Title: ' + item.accountTitle + '\n' +
                '📅 Date: ' + new Date(item.createdAt).toLocaleString() + '\n\n' +
                '━━━━━━━━━━━━━━━━━━━━━━';
        }

        var actionKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '✅ APPROVE',
                            callback_data: 'approve_' + type + '_' + item._id
                        },
                        {
                            text: '❌ REJECT',
                            callback_data: 'reject_' + type + '_' + item._id
                        }
                    ]
                ]
            }
        };

        var sentMessage;

        if (type === 'deposit' && item.screenshot && fs.existsSync(item.screenshot)) {
            try {
                sentMessage = await bot.sendPhoto(chatId, item.screenshot, {
                    caption: message,
                    parse_mode: 'Markdown',
                    ...actionKeyboard
                });
            } catch (photoError) {
                sentMessage = await bot.sendMessage(chatId, message + '\n\n⚠️ Screenshot could not be loaded', {
                    parse_mode: 'Markdown',
                    ...actionKeyboard
                });
            }
        } else {
            sentMessage = await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                ...actionKeyboard
            });
        }

        // Save the message ID so we can remove buttons later
        if (sentMessage && sentMessage.message_id) {
            await Transaction.findByIdAndUpdate(item._id, {
                telegramMsgId: sentMessage.message_id
            });
        }
    }
}

// ============================================================
// HELPER: PROCESS DEPOSIT APPROVAL/REJECTION
// ============================================================
async function processDepositAction(transactionId, status, chatId) {
    var transaction = await Transaction.findById(transactionId);

    if (!transaction) {
        await bot.sendMessage(chatId, '❌ Transaction not found!');
        return;
    }

    if (transaction.status !== 'pending') {
        await bot.sendMessage(chatId, '⚠️ This deposit was already *' + transaction.status + '*!', {
            parse_mode: 'Markdown'
        });
        return;
    }

    // Update transaction status
    transaction.status = status;
    transaction.processedAt = new Date();
    await transaction.save();

    // Remove buttons from the original notification message
    if (transaction.telegramMsgId) {
        try {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: transaction.telegramMsgId
                }
            );
        } catch (e) {
            console.log('Could not remove buttons:', e.message);
        }

        // Update the message text to show status
        try {
            var updatedCaption = '';
            if (status === 'approved') {
                updatedCaption = '✅ *DEPOSIT APPROVED!*\n\n' +
                    '👤 ' + transaction.username + '\n' +
                    '💵 PKR ' + transaction.amount.toLocaleString() + '\n' +
                    '📅 ' + new Date().toLocaleString();
            } else {
                updatedCaption = '❌ *DEPOSIT REJECTED!*\n\n' +
                    '👤 ' + transaction.username + '\n' +
                    '💵 PKR ' + transaction.amount.toLocaleString() + '\n' +
                    '📅 ' + new Date().toLocaleString();
            }

            if (transaction.screenshot && fs.existsSync(transaction.screenshot)) {
                await bot.editMessageCaption(updatedCaption, {
                    chat_id: chatId,
                    message_id: transaction.telegramMsgId,
                    parse_mode: 'Markdown'
                });
            } else {
                await bot.editMessageText(updatedCaption, {
                    chat_id: chatId,
                    message_id: transaction.telegramMsgId,
                    parse_mode: 'Markdown'
                });
            }
        } catch (e) {
            console.log('Could not update message:', e.message);
        }
    }

    // If approved, activate the plan
    if (status === 'approved') {
        var user = await User.findOne({ username: transaction.username });
        var plan = await Plan.findOne({ planId: transaction.planId });

        if (user && plan) {
            var dailyProfitAmount = plan.amount * (plan.dailyProfit / 100);

            // Add new plan to user's active plans array
            user.activePlans.push({
                planId: plan.planId,
                name: plan.name,
                amount: plan.amount,
                dailyProfit: dailyProfitAmount,
                startDate: new Date(),
                endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
                profitDays: 0
            });

            user.totalInvested += plan.amount;

            // Give first day profit immediately
            var firstDayProfit = dailyProfitAmount;
            user.balance += firstDayProfit;
            user.totalEarned += firstDayProfit;

            // Increment profit days for the new plan
            var newPlanIndex = user.activePlans.length - 1;
            user.activePlans[newPlanIndex].profitDays += 1;

            await user.save();

            // Record profit transaction
            await new Transaction({
                userId: user._id,
                username: user.username,
                type: 'profit',
                amount: firstDayProfit,
                status: 'approved'
            }).save();

            // Process referral bonus
            if (user.referredBy) {
                var referrer = await User.findOne({ referralCode: user.referredBy });

                if (referrer) {
                    var bonusSetting = await Setting.findOne({ key: 'referralBonus' });
                    var bonusPercent = bonusSetting?.value || 11;
                    var bonusAmount = plan.amount * (bonusPercent / 100);

                    referrer.balance += bonusAmount;
                    referrer.referralEarnings += bonusAmount;
                    await referrer.save();

                    await new Transaction({
                        userId: referrer._id,
                        username: referrer.username,
                        type: 'referral',
                        amount: bonusAmount,
                        status: 'approved'
                    }).save();

                    await bot.sendMessage(chatId,
                        '🎁 *Referral Bonus!*\n\n' +
                        'From: ' + user.username + ' → To: ' + referrer.username + '\n' +
                        'Amount: PKR ' + bonusAmount.toLocaleString() + '\n' +
                        'Bonus: ' + bonusPercent + '%',
                        { parse_mode: 'Markdown' }
                    );
                }
            }
        }
    }

    await bot.sendMessage(chatId,
        '✅ *DEPOSIT ' + status.toUpperCase() + '!*\n\n' +
        '👤 ' + transaction.username + '\n' +
        '💵 PKR ' + transaction.amount.toLocaleString(),
        { parse_mode: 'Markdown', ...getMainMenuKeyboard() }
    );
}

// ============================================================
// HELPER: PROCESS WITHDRAWAL APPROVAL/REJECTION
// ============================================================
async function processWithdrawalAction(transactionId, status, chatId) {
    var transaction = await Transaction.findById(transactionId);

    if (!transaction) {
        await bot.sendMessage(chatId, '❌ Transaction not found!');
        return;
    }

    if (transaction.status !== 'pending') {
        await bot.sendMessage(chatId, '⚠️ This withdrawal was already *' + transaction.status + '*!', {
            parse_mode: 'Markdown'
        });
        return;
    }

    // Update transaction status
    transaction.status = status;
    transaction.processedAt = new Date();
    await transaction.save();

    // Remove buttons from the original notification message
    if (transaction.telegramMsgId) {
        try {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                {
                    chat_id: chatId,
                    message_id: transaction.telegramMsgId
                }
            );
        } catch (e) {
            console.log('Could not remove buttons:', e.message);
        }

        // Update the message text to show status
        try {
            var updatedText = '';
            if (status === 'approved') {
                updatedText = '✅ *WITHDRAWAL APPROVED!*\n\n' +
                    '👤 ' + transaction.username + '\n' +
                    '💵 PKR ' + transaction.amount.toLocaleString() + '\n' +
                    '🏦 ' + transaction.accountType.toUpperCase() + '\n' +
                    '📅 ' + new Date().toLocaleString();
            } else {
                updatedText = '❌ *WITHDRAWAL REJECTED!*\n\n' +
                    '👤 ' + transaction.username + '\n' +
                    '💵 PKR ' + transaction.amount.toLocaleString() + '\n' +
                    'ℹ️ Amount will be refunded after 1 hour.\n' +
                    '📅 ' + new Date().toLocaleString();
            }

            await bot.editMessageText(updatedText, {
                chat_id: chatId,
                message_id: transaction.telegramMsgId,
                parse_mode: 'Markdown'
            });
        } catch (e) {
            console.log('Could not update message:', e.message);
        }
    }

    // If approved, update total withdrawn
    if (status === 'approved') {
        var user = await User.findOne({ username: transaction.username });

        if (user) {
            user.totalWithdrawn += transaction.amount;
            await user.save();
        }
    }

    // If rejected, schedule refund after 1 hour
    if (status === 'rejected') {
        var user = await User.findOne({ username: transaction.username });

        if (user) {
            transaction.refundAt = new Date(Date.now() + 3600000); // 1 hour later
            await transaction.save();

            await bot.sendMessage(chatId,
                'ℹ️ *Refund Scheduled*\n\n' +
                'Amount PKR ' + transaction.amount.toLocaleString() + ' will be refunded to ' +
                user.username + ' after 1 hour.',
                { parse_mode: 'Markdown' }
            );

            // Set timeout for refund
            setTimeout(async function () {
                try {
                    var updatedUser = await User.findOne({ username: transaction.username });
                    if (updatedUser && transaction.status === 'rejected') {
                        updatedUser.balance += transaction.amount;
                        await updatedUser.save();

                        transaction.status = 'refunded';
                        await transaction.save();

                        await new Transaction({
                            userId: updatedUser._id,
                            username: updatedUser.username,
                            type: 'refund',
                            amount: transaction.amount,
                            status: 'completed'
                        }).save();

                        await bot.sendMessage(chatId,
                            '✅ *REFUND COMPLETED!*\n\n' +
                            '👤 ' + updatedUser.username + '\n' +
                            '💵 PKR ' + transaction.amount.toLocaleString() + '\n' +
                            '📅 ' + new Date().toLocaleString(),
                            { parse_mode: 'Markdown' }
                        );
                    }
                } catch (error) {
                    console.error('Refund error:', error.message);
                }
            }, 3600000); // 1 hour = 3,600,000 ms
        }
    }

    await bot.sendMessage(chatId,
        '✅ *WITHDRAWAL ' + status.toUpperCase() + '!*\n\n' +
        '👤 ' + transaction.username + '\n' +
        '💵 PKR ' + transaction.amount.toLocaleString(),
        { parse_mode: 'Markdown' }
    );
}

// ============================================================
// NOTIFICATION HELPERS
// ============================================================
async function notifyAdminHTML(message) {
    if (bot && process.env.TELEGRAM_ADMIN_ID) {
        try {
            await bot.sendMessage(process.env.TELEGRAM_ADMIN_ID, message, {
                parse_mode: 'HTML'
            });
        } catch (error) {
            console.error('Notification error:', error.message);
        }
    }
}

async function notifyAdminTransfer(senderUsername, senderPID, receiverUsername, receiverPID, amount, fee) {
    var message = '🔄 <b>FUND TRANSFER</b>\n\n' +
        '📤 Sender: ' + senderUsername + ' (PID:' + senderPID + ')\n' +
        '📥 Receiver: ' + receiverUsername + ' (PID:' + receiverPID + ')\n' +
        '💵 Amount: PKR ' + amount.toLocaleString() + '\n' +
        '💰 Fee: PKR ' + fee.toFixed(2) + '\n' +
        '📅 ' + new Date().toLocaleString();

    await notifyAdminHTML(message);
}

// ============================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================
function authenticateRequest(req, res, next) {
    var authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required. Please login first.'
        });
    }

    // Support both "Bearer token" and just "token"
    var token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    try {
        var decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            error: 'Invalid or expired token. Please login again.'
        });
    }
}

// ============================================================
// API ROUTES
// ============================================================

// Health Check
app.get('/api/health', function (req, res) {
    res.json({
        success: true,
        message: 'Profit 24 API is running',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ============================================================
// USER REGISTRATION
// ============================================================
app.post('/api/signup', async function (req, res) {
    try {
        var username = req.body.username;
        var whatsapp = req.body.whatsapp;
        var password = req.body.password;
        var referralCode = req.body.referralCode;

        // Validate inputs
        if (!username || !whatsapp || !password) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required: username, WhatsApp number, and password'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters long'
            });
        }

        // Check if username already exists
        var existingUser = await User.findOne({ username: username.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Username is already taken. Please choose another username.'
            });
        }

        // Generate PID from WhatsApp number
        var pid = generatePID(whatsapp);

        // Ensure PID is unique
        var existingPID = await User.findOne({ pid: pid });
        if (existingPID) {
            // Add a random suffix if PID already exists
            pid = pid + Math.floor(Math.random() * 9).toString();
        }

        // Hash the password
        var hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        var newUser = new User({
            username: username.toLowerCase(),
            whatsapp: whatsapp,
            password: hashedPassword,
            pid: pid,
            referralCode: pid,
            referredBy: referralCode || null,
            balance: 0,
            activePlans: [],
            totalInvested: 0,
            totalEarned: 0,
            referralEarnings: 0,
            totalWithdrawn: 0,
            status: 'active'
        });

        await newUser.save();

        // Generate JWT token
        var token = jwt.sign(
            { userId: newUser._id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        // Notify admin
        await notifyAdminHTML(
            '🆕 <b>New User Registered!</b>\n\n' +
            '👤 Username: ' + username + '\n' +
            '🆔 PID: ' + pid + '\n' +
            '📱 WhatsApp: ' + whatsapp + '\n' +
            '📅 ' + new Date().toLocaleString()
        );

        // Return success
        res.status(201).json({
            success: true,
            message: 'Account created successfully! Welcome to Profit 24.',
            token: token,
            username: newUser.username,
            pid: newUser.pid
        });

    } catch (error) {
        console.error('Signup Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Registration failed. Please try again later.'
        });
    }
});

// ============================================================
// USER LOGIN
// ============================================================
app.post('/api/login', async function (req, res) {
    try {
        var username = req.body.username;
        var password = req.body.password;

        // Validate inputs
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        // Find user
        var user = await User.findOne({ username: username.toLowerCase() });

        if (!user) {
            return res.status(400).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        // Check if user is blocked
        if (user.status === 'blocked') {
            return res.status(403).json({
                success: false,
                error: 'Your account has been blocked. Please contact support.'
            });
        }

        // Verify password
        var isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(400).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        // Generate JWT token
        var token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        // Return success
        res.json({
            success: true,
            message: 'Login successful! Welcome back.',
            token: token,
            username: user.username,
            pid: user.pid,
            balance: user.balance
        });

    } catch (error) {
        console.error('Login Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Login failed. Please try again.'
        });
    }
});

// ============================================================
// GET DASHBOARD DATA
// ============================================================
app.get('/api/dashboard', authenticateRequest, async function (req, res) {
    try {
        var user = await User.findById(req.userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Calculate today's profit
        var today = new Date();
        today.setHours(0, 0, 0, 0);

        var todayProfitResult = await Transaction.aggregate([
            {
                $match: {
                    userId: user._id,
                    type: 'profit',
                    status: 'approved',
                    createdAt: { $gte: today }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        // Count pending transactions
        var pendingDeposits = await Transaction.countDocuments({
            userId: user._id,
            type: 'deposit',
            status: 'pending'
        });

        var pendingWithdrawals = await Transaction.countDocuments({
            userId: user._id,
            type: 'withdraw',
            status: 'pending'
        });

        // Count referrals
        var referralCount = await User.countDocuments({
            referredBy: user.referralCode
        });

        // Return dashboard data
        res.json({
            success: true,
            username: user.username,
            pid: user.pid,
            profilePic: user.profilePic,
            balance: user.balance || 0,
            activePlans: user.activePlans || [],
            totalInvested: user.totalInvested || 0,
            totalEarned: user.totalEarned || 0,
            referralEarnings: user.referralEarnings || 0,
            totalWithdrawn: user.totalWithdrawn || 0,
            referralCount: referralCount,
            referralCode: user.referralCode,
            todayProfit: todayProfitResult[0]?.total || 0,
            pendingDeposits: pendingDeposits,
            pendingWithdrawals: pendingWithdrawals
        });

    } catch (error) {
        console.error('Dashboard Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to load dashboard data'
        });
    }
});

// ============================================================
// GET INVESTMENT PLANS
// ============================================================
app.get('/api/plans', authenticateRequest, async function (req, res) {
    try {
        var plans = await Plan.find({ isActive: true })
            .sort({ planId: 1 })
            .lean();

        res.json({
            success: true,
            plans: plans
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load plans'
        });
    }
});

// ============================================================
// GET DEPOSIT ACCOUNTS
// ============================================================
app.get('/api/deposit-accounts', authenticateRequest, async function (req, res) {
    try {
        var easypaisaNumber = await Setting.findOne({ key: 'easypaisaNumber' });
        var easypaisaTitle = await Setting.findOne({ key: 'easypaisaTitle' });
        var jazzcashNumber = await Setting.findOne({ key: 'jazzcashNumber' });
        var jazzcashTitle = await Setting.findOne({ key: 'jazzcashTitle' });

        res.json({
            success: true,
            easypaisa: {
                number: easypaisaNumber?.value || 'Not configured',
                title: easypaisaTitle?.value || 'Not configured'
            },
            jazzcash: {
                number: jazzcashNumber?.value || 'Not configured',
                title: jazzcashTitle?.value || 'Not configured'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load account details'
        });
    }
});

// ============================================================
// SUBMIT DEPOSIT
// ============================================================
app.post('/api/deposit', authenticateRequest, uploadDeposit.single('screenshot'), async function (req, res) {
    try {
        // Check if deposits are enabled
        var depositEnabled = await Setting.findOne({ key: 'depositEnabled' });
        if (depositEnabled?.value === false) {
            return res.status(400).json({
                success: false,
                error: 'Deposits are temporarily disabled. Please try again later.'
            });
        }

        var planId = req.body.planId;
        var accountType = req.body.accountType;
        var txId = req.body.txId;

        // Validate inputs
        if (!planId || !accountType || !txId) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required: plan, account type, and transaction ID'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Payment screenshot is required'
            });
        }

        // Find the plan
        var plan = await Plan.findOne({ planId: parseInt(planId) });

        if (!plan) {
            return res.status(400).json({
                success: false,
                error: 'Invalid plan selected'
            });
        }

        // Get user
        var user = await User.findById(req.userId);

        // Create transaction record
        var transaction = new Transaction({
            userId: req.userId,
            username: user.username,
            type: 'deposit',
            amount: plan.amount,
            accountType: accountType,
            screenshot: req.file.path,
            txId: txId,
            planId: plan.planId,
            planName: plan.name,
            status: 'pending'
        });

        await transaction.save();

        // Notify admin
        await notifyAdminHTML(
            '💰 <b>NEW DEPOSIT PENDING</b>\n\n' +
            '👤 User: ' + user.username + '\n' +
            '🆔 PID: ' + user.pid + '\n' +
            '📋 Plan: ' + plan.name + '\n' +
            '💵 Amount: PKR ' + plan.amount.toLocaleString() + '\n' +
            '🏦 Method: ' + accountType.toUpperCase() + '\n' +
            '🔢 TxID: ' + txId + '\n' +
            '📅 ' + new Date().toLocaleString()
        );

        // Send screenshot to admin if bot is connected
        if (bot) {
            try {
                await bot.sendPhoto(process.env.TELEGRAM_ADMIN_ID, req.file.path, {
                    caption: '📸 Screenshot from ' + user.username
                });
            } catch (e) {
                console.log('Screenshot send failed:', e.message);
            }
        }

        // Return success
        res.json({
            success: true,
            message: 'Deposit submitted successfully! Waiting for admin approval.',
            transactionId: transaction._id
        });

    } catch (error) {
        console.error('Deposit Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to submit deposit. Please try again.'
        });
    }
});

// ============================================================
// SUBMIT WITHDRAWAL
// ============================================================
app.post('/api/withdraw', authenticateRequest, async function (req, res) {
    try {
        // Check if withdrawals are enabled
        var withdrawEnabled = await Setting.findOne({ key: 'withdrawEnabled' });
        if (withdrawEnabled?.value === false) {
            return res.status(400).json({
                success: false,
                error: 'Withdrawals are temporarily disabled.'
            });
        }

        var accountType = req.body.accountType;
        var accountNumber = req.body.accountNumber;
        var accountTitle = req.body.accountTitle;
        var amount = parseFloat(req.body.amount);

        // Validate inputs
        if (!accountType || !accountNumber || !accountTitle || !amount) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required'
            });
        }

        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid withdrawal amount'
            });
        }

        // Get user
        var user = await User.findById(req.userId);

        // Check if user has any active plan
        if (!user.activePlans || user.activePlans.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No active investment plan found. Please invest first.'
            });
        }

        // Check minimum withdrawal
        var minWithdrawSetting = await Setting.findOne({ key: 'minWithdraw' });
        var minWithdraw = minWithdrawSetting?.value || 30;

        if (amount < minWithdraw) {
            return res.status(400).json({
                success: false,
                error: 'Minimum withdrawal amount is PKR ' + minWithdraw.toLocaleString()
            });
        }

        // Check balance
        if (user.balance < amount) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient balance'
            });
        }

        // Deduct amount from balance
        user.balance -= amount;
        await user.save();

        // Create transaction record
        var transaction = new Transaction({
            userId: req.userId,
            username: user.username,
            type: 'withdraw',
            amount: amount,
            accountType: accountType,
            accountNumber: accountNumber,
            accountTitle: accountTitle,
            status: 'pending'
        });

        await transaction.save();

        // Notify admin
        await notifyAdminHTML(
            '💸 <b>NEW WITHDRAWAL REQUEST</b>\n\n' +
            '👤 User: ' + user.username + '\n' +
            '🆔 PID: ' + user.pid + '\n' +
            '💵 Amount: PKR ' + amount.toLocaleString() + '\n' +
            '🏦 Method: ' + accountType.toUpperCase() + '\n' +
            '🔢 Account: ' + accountNumber + '\n' +
            '📛 Title: ' + accountTitle + '\n' +
            '📅 ' + new Date().toLocaleString()
        );

        // Return success
        res.json({
            success: true,
            message: 'Withdrawal request submitted! Amount has been deducted from your balance.',
            transactionId: transaction._id
        });

    } catch (error) {
        console.error('Withdrawal Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to submit withdrawal request'
        });
    }
});

// ============================================================
// FUND TRANSFER
// ============================================================
app.post('/api/fund-transfer', authenticateRequest, async function (req, res) {
    try {
        // Check if transfers are enabled
        var transferEnabled = await Setting.findOne({ key: 'fundTransferEnabled' });
        if (transferEnabled?.value === false) {
            return res.status(400).json({
                success: false,
                error: 'Fund Transfer is temporarily disabled.'
            });
        }

        var receiverPid = req.body.receiverPid;
        var amount = parseFloat(req.body.amount);

        // Validate inputs
        if (!receiverPid || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Receiver PID and Amount are required'
            });
        }

        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid transfer amount'
            });
        }

        // Get sender
        var sender = await User.findById(req.userId);

        // Check if sender has any active plan
        if (!sender.activePlans || sender.activePlans.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No active investment plan. Please invest first!'
            });
        }

        // Calculate fee
        var feeSetting = await Setting.findOne({ key: 'fundTransferFee' });
        var feePercent = feeSetting?.value || 0;
        var feeAmount = amount * (feePercent / 100);
        var totalDeduction = amount + feeAmount;

        // Check balance
        if (sender.balance < totalDeduction) {
            return res.status(400).json({
                success: false,
                error: 'Insufficient balance. Total with fee: PKR ' + totalDeduction.toFixed(2)
            });
        }

        // Find receiver
        var receiver = await User.findOne({ pid: receiverPid });

        if (!receiver) {
            return res.status(400).json({
                success: false,
                error: 'Receiver PID not found. Please check and try again.'
            });
        }

        // Prevent self-transfer
        if (receiver._id.toString() === sender._id.toString()) {
            return res.status(400).json({
                success: false,
                error: 'You cannot transfer funds to yourself'
            });
        }

        // Process transfer
        sender.balance -= totalDeduction;
        receiver.balance += amount;

        await sender.save();
        await receiver.save();

        // Record transactions
        await new Transaction({
            userId: sender._id,
            username: sender.username,
            type: 'transfer_sent',
            amount: amount,
            fee: feeAmount,
            status: 'completed',
            relatedUserId: receiver._id,
            relatedUsername: receiver.username
        }).save();

        await new Transaction({
            userId: receiver._id,
            username: receiver.username,
            type: 'transfer_received',
            amount: amount,
            status: 'completed',
            relatedUserId: sender._id,
            relatedUsername: sender.username
        }).save();

        // Notify admin
        await notifyAdminTransfer(
            sender.username, sender.pid,
            receiver.username, receiver.pid,
            amount, feeAmount
        );

        // Return success
        res.json({
            success: true,
            message: 'Transfer completed successfully!',
            senderBalance: sender.balance,
            fee: feeAmount,
            receiverUsername: receiver.username
        });

    } catch (error) {
        console.error('Transfer Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Transfer failed. Please try again.'
        });
    }
});

// ============================================================
// VERIFY PID (For Fund Transfer)
// ============================================================
app.post('/api/verify-pid', authenticateRequest, async function (req, res) {
    try {
        var pid = req.body.pid;

        if (!pid) {
            return res.status(400).json({
                success: false,
                error: 'PID is required'
            });
        }

        var receiver = await User.findOne({ pid: pid })
            .select('username whatsapp pid profilePic')
            .lean();

        if (!receiver) {
            return res.status(404).json({
                success: false,
                error: 'No user found with this PID'
            });
        }

        res.json({
            success: true,
            user: receiver
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Verification failed'
        });
    }
});

// ============================================================
// GET USER PROFILE
// ============================================================
app.get('/api/profile', authenticateRequest, async function (req, res) {
    try {
        var user = await User.findById(req.userId)
            .select('username whatsapp pid profilePic createdAt')
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            user: user
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load profile'
        });
    }
});

// ============================================================
// UPDATE PROFILE
// ============================================================
app.put('/api/profile', authenticateRequest, uploadProfile.single('profilePic'), async function (req, res) {
    try {
        var user = await User.findById(req.userId);

        // Update WhatsApp number
        if (req.body.whatsapp) {
            user.whatsapp = req.body.whatsapp;
            // Regenerate PID from new WhatsApp
            user.pid = generatePID(req.body.whatsapp);
            user.referralCode = user.pid;
        }

        // Update password
        if (req.body.password) {
            if (req.body.password.length < 6) {
                return res.status(400).json({
                    success: false,
                    error: 'Password must be at least 6 characters'
                });
            }
            user.password = await bcrypt.hash(req.body.password, 10);
        }

        // Update profile picture
        if (req.file) {
            user.profilePic = '/uploads/' + req.file.filename;
        }

        await user.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                username: user.username,
                pid: user.pid,
                whatsapp: user.whatsapp,
                profilePic: user.profilePic
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to update profile'
        });
    }
});

// ============================================================
// GET TRANSACTIONS
// ============================================================
app.get('/api/transactions', authenticateRequest, async function (req, res) {
    try {
        var transactions = await Transaction.find({ userId: req.userId })
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        res.json({
            success: true,
            transactions: transactions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load transactions'
        });
    }
});

// ============================================================
// GET DEPOSIT HISTORY
// ============================================================
app.get('/api/deposits', authenticateRequest, async function (req, res) {
    try {
        var deposits = await Transaction.find({
            userId: req.userId,
            type: 'deposit'
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        res.json({
            success: true,
            deposits: deposits
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load deposit history'
        });
    }
});

// ============================================================
// GET WITHDRAWAL HISTORY
// ============================================================
app.get('/api/withdrawals', authenticateRequest, async function (req, res) {
    try {
        var withdrawals = await Transaction.find({
            userId: req.userId,
            type: 'withdraw'
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        res.json({
            success: true,
            withdrawals: withdrawals
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load withdrawal history'
        });
    }
});

// ============================================================
// GET MY TEAM (REFERRALS)
// ============================================================
app.get('/api/team', authenticateRequest, async function (req, res) {
    try {
        var user = await User.findById(req.userId);

        var teamMembers = await User.find({ referredBy: user.referralCode })
            .select('username pid totalInvested totalEarned createdAt')
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            success: true,
            teamCount: teamMembers.length,
            team: teamMembers
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load team'
        });
    }
});

// ============================================================
// GET LEADERBOARD
// ============================================================
app.get('/api/leaderboard', authenticateRequest, async function (req, res) {
    try {
        // Top Investors
        var topInvestors = await User.find({ status: 'active' })
            .sort({ totalInvested: -1 })
            .limit(10)
            .select('username pid totalInvested')
            .lean();

        // Top Referrers
        var topReferrers = await User.aggregate([
            { $match: { status: 'active' } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'referralCode',
                    foreignField: 'referredBy',
                    as: 'refs'
                }
            },
            {
                $project: {
                    username: 1,
                    pid: 1,
                    count: { $size: '$refs' }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        res.json({
            success: true,
            topInvestors: topInvestors,
            topReferrers: topReferrers
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load leaderboard'
        });
    }
});

// ============================================================
// GET FAQs
// ============================================================
app.get('/api/faqs', async function (req, res) {
    try {
        var faqs = await FAQ.find()
            .sort({ order: 1 })
            .lean();

        res.json({
            success: true,
            faqs: faqs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load FAQs'
        });
    }
});

// ============================================================
// GET PUBLIC SETTINGS
// ============================================================
app.get('/api/settings', async function (req, res) {
    try {
        var settings = await Setting.find({}).lean();
        var result = {};
        settings.forEach(function (setting) {
            result[setting.key] = setting.value;
        });

        res.json({
            success: true,
            settings: result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to load settings'
        });
    }
});

// ============================================================
// AI CHATBOT (URDU + ENGLISH SUPPORT)
// ============================================================
app.post('/api/chat', async function (req, res) {
    try {
        var message = (req.body.message || '').trim();
        var lowerMessage = message.toLowerCase();

        // Detect if message is in Urdu
        var isUrdu = /[\u0600-\u06FF]/.test(message);

        var reply = '';

        // ========================================================
        // URDU RESPONSES
        // ========================================================
        if (isUrdu) {
            if (lowerMessage.includes('سرمایہ') || lowerMessage.includes('انویسٹ') || lowerMessage.includes('پلان') || lowerMessage.includes('ڈپازٹ')) {
                reply = 'سرمایہ کاری کرنے کے لیے:\n\n1️⃣ ڈپازٹ پیج پر جائیں\n2️⃣ کوئی بھی پلان منتخب کریں (PKR 360 سے PKR 50,000 تک)\n3️⃣ Easypaisa یا JazzCash منتخب کریں\n4️⃣ دیے گئے اکاؤنٹ میں رقم بھیجیں\n5️⃣ اسکرین شاٹ اور ٹرانزیکشن ID اپ لوڈ کریں\n6️⃣ ایڈمن کی منظوری کا انتظار کریں\n\nمنظوری کے فوراً بعد پہلا منافع مل جائے گا! 🎉';
            } else if (lowerMessage.includes('منافع') || lowerMessage.includes('پرافٹ') || lowerMessage.includes('کمائی') || lowerMessage.includes('انکم')) {
                reply = '📈 *منافع کی تفصیلات*\n\nآپ 60 دنوں تک روزانہ 11% منافع کماتے ہیں!\n\nمثال:\n🔹 PKR 360 = PKR 39.60 روزانہ × 60 دن = PKR 2,376 کل\n🔹 PKR 5,000 = PKR 550 روزانہ × 60 دن = PKR 33,000 کل\n🔹 PKR 50,000 = PKR 5,500 روزانہ × 60 دن = PKR 330,000 کل\n\nپہلا منافع ڈپازٹ کی منظوری کے فوراً بعد ملتا ہے، پھر روزانہ رات 12 بجے خودکار ملتا ہے۔';
            } else if (lowerMessage.includes('نکاسی') || lowerMessage.includes('وڈرا') || lowerMessage.includes('پیسے') || lowerMessage.includes('کیش')) {
                reply = 'رقم نکالنے کے لیے:\n\n1️⃣ وڈرا پیج پر جائیں\n2️⃣ Easypaisa یا JazzCash منتخب کریں\n3️⃣ اپنا اکاؤنٹ نمبر اور ٹائٹل درج کریں\n4️⃣ رقم درج کریں (کم از کم PKR 30)\n5️⃣ رقم فوری طور پر بیلنس سے کٹ جائے گی\n6️⃣ ایڈمن آپ کی درخواست پر کارروائی کرے گا\n\nنوٹ: آپ جتنی بار چاہیں وڈرا لگا سکتے ہیں!';
            } else if (lowerMessage.includes('ریف') || lowerMessage.includes('دوست') || lowerMessage.includes('بونس') || lowerMessage.includes('ریف')) {
                reply = '🎁 *ریف سسٹم*\n\nاپنا PID کوڈ بطور ریفرل لنک شیئر کریں۔ جب کوئی آپ کے لنک سے جوائن کرے اور سرمایہ کاری کرے، آپ کو فوری طور پر ان کی سرمایہ کاری کا 11% بونس ملے گا!\n\nمثال: اگر وہ PKR 10,000 لگاتے ہیں تو آپ کو PKR 1,100 ملیں گے۔ 💰';
            } else if (lowerMessage.includes('ٹرانسفر') || lowerMessage.includes('منتقل') || lowerMessage.includes('بھیجنا')) {
                reply = '🔄 *فنڈ ٹرانسفر*\n\n1️⃣ فنڈ ٹرانسفر پیج پر جائیں\n2️⃣ وصول کنندہ کا PID درج کریں\n3️⃣ رقم درج کریں\n4️⃣ Next پر کلک کر کے تصدیق کریں\n5️⃣ Confirm Transfer پر کلک کریں\n\nٹرانسفر فوری ہے، کسی منظوری کی ضرورت نہیں! 🚀';
            } else if (lowerMessage.includes('بیلنس') || lowerMessage.includes('رقم') || lowerMessage.includes('اکاؤنٹ')) {
                reply = '💰 آپ کا بیلنس ڈیش بورڈ پر نظر آتا ہے۔ آپ دیکھ سکتے ہیں:\n\n• کل بیلنس\n• آج کا منافع\n• کل سرمایہ کاری\n• کل کمائی\n• ریفرل بونس\n• زیر التوا ڈپازٹ\n• زیر التوا وڈرا\n• کل نکاسی';
            } else if (lowerMessage.includes('سلام') || lowerMessage.includes('ہیلو') || lowerMessage.includes('ہائے') || lowerMessage.includes('آداب')) {
                reply = 'السلام علیکم! 👋\n\nپروفٹ 24 میں خوش آمدید!\n\nمیں آپ کی کیا مدد کر سکتا ہوں؟\n\nآپ پوچھ سکتے ہیں:\n• سرمایہ کاری کیسے کریں؟\n• کتنے پلان ہیں؟\n• منافع کب ملتا ہے؟\n• رقم کیسے نکالیں؟\n• ریفرل بونس کیا ہے؟\n• فنڈ ٹرانسفر کیسے کریں؟';
            } else if (lowerMessage.includes('شکریہ') || lowerMessage.includes('تھینکس') || lowerMessage.includes('مہربانی')) {
                reply = 'آپ کا شکریہ! 😊\n\nاگر کوئی اور مدد چاہیے تو ضرور پوچھیں۔ ہم 24/7 آپ کی خدمت کے لیے حاضر ہیں۔\n\nپروفٹ 24 کے ساتھ خوشحال سرمایہ کاری کریں! 💎';
            } else if (lowerMessage.includes('پلان') || lowerMessage.includes('پیکج') || lowerMessage.includes('لِسٹ')) {
                reply = '📋 *دستیاب پلان*\n\n1. Starter - PKR 360\n2. Silver - PKR 860\n3. Gold - PKR 1,460\n4. Platinum - PKR 2,660\n5. Diamond - PKR 4,260\n6. Ruby - PKR 6,060\n7. Emerald - PKR 9,060\n8. Sapphire - PKR 14,060\n9. Titanium - PKR 21,060\n10. Master - PKR 30,000\n11. Custom - PKR 50,000+\n\nتمام پلان: 11% روزانہ منافع، 60 دن';
            } else if (lowerMessage.includes('پاسورڈ') || lowerMessage.includes('پروفائل') || lowerMessage.includes('اپڈیٹ')) {
                reply = 'پروفائل اپڈیٹ کرنے کے لیے:\n\n1️⃣ پروفائل پیج پر جائیں\n2️⃣ واٹس ایپ نمبر تبدیل کریں\n3️⃣ پاسورڈ تبدیل کریں\n4️⃣ Save Changes پر کلک کریں';
            } else if (lowerMessage.includes('سپورٹ') || lowerMessage.includes('مدد') || lowerMessage.includes('ہیلپ') || lowerMessage.includes('ایڈمن')) {
                reply = '📞 *سپورٹ*\n\n1. ایڈمن سے رابطہ: واٹس ایپ +258867532400\n2. سپورٹ چینل: ہمارے واٹس ایپ چینل میں شامل ہوں\n3. لائیو چیٹ: ویب سائٹ پر AI اسسٹنٹ سے بات کریں\n\nسپورٹ بٹن ڈیش بورڈ پر موجود ہے۔';
            } else {
                reply = 'معذرت، میں صرف پروفٹ 24 پلیٹ فارم سے متعلق سوالات کے جواب دے سکتا ہوں۔\n\nبراہ کرم پوچھیں:\n• سرمایہ کاری کیسے کریں؟\n• منافع کب ملتا ہے؟\n• رقم کیسے نکالیں؟\n• ریفرل بونس کیا ہے؟\n• فنڈ ٹرانسفر کیسے کریں؟\n• کتنے پلان ہیں؟\n\nیا مدد کے لیے سپورٹ سے رابطہ کریں۔';
            }
        }
        // ========================================================
        // ENGLISH RESPONSES
        // ========================================================
        else {
            if (lowerMessage.includes('invest') || lowerMessage.includes('deposit') || lowerMessage.includes('plan') || lowerMessage.includes('package') || lowerMessage.includes('start')) {
                reply = '💰 *How to Invest in Profit 24*\n\n1️⃣ Go to the Deposit page\n2️⃣ Select an investment plan (PKR 360 to PKR 50,000+)\n3️⃣ Choose Easypaisa or JazzCash\n4️⃣ Send the exact amount to the given account\n5️⃣ Upload payment screenshot with Transaction ID\n6️⃣ Submit for admin approval\n\nYour first profit is credited immediately after approval! 🎉';
            } else if (lowerMessage.includes('profit') || lowerMessage.includes('earning') || lowerMessage.includes('return') || lowerMessage.includes('daily') || lowerMessage.includes('income')) {
                reply = '📈 *Profit Details*\n\nYou earn 11% daily profit for 60 days!\n\nExamples:\n🔹 PKR 360 = PKR 39.60 daily × 60 = PKR 2,376 total\n🔹 PKR 5,000 = PKR 550 daily × 60 = PKR 33,000 total\n🔹 PKR 50,000 = PKR 5,500 daily × 60 = PKR 330,000 total\n\nFirst profit: Immediately after approval\nAfter that: Automatically at 12:00 AM daily';
            } else if (lowerMessage.includes('withdraw') || lowerMessage.includes('cash') || lowerMessage.includes('withdrawal') || lowerMessage.includes('payout')) {
                reply = '💸 *How to Withdraw*\n\n1️⃣ Go to the Withdraw page\n2️⃣ Select Easypaisa or JazzCash\n3️⃣ Enter your account number and title\n4️⃣ Enter amount (Minimum: PKR 30)\n5️⃣ Amount is instantly deducted from balance\n6️⃣ Admin will process your request\n\nNote: You can submit multiple withdrawals! No limit on requests.';
            } else if (lowerMessage.includes('refer') || lowerMessage.includes('bonus') || lowerMessage.includes('referral') || lowerMessage.includes('invite') || lowerMessage.includes('friend')) {
                reply = '🎁 *Referral System*\n\nShare your PID code as referral link. When someone joins using your link and invests, you earn 11% of their investment as bonus instantly!\n\nExample: If they invest PKR 10,000, you receive PKR 1,100 bonus. 💰\n\nYour PID and referral link can be found on your Dashboard.';
            } else if (lowerMessage.includes('transfer') || lowerMessage.includes('send fund') || lowerMessage.includes('send money')) {
                reply = '🔄 *Fund Transfer*\n\n1️⃣ Go to Fund Transfer page\n2️⃣ Enter receiver\'s PID\n3️⃣ Enter amount to transfer\n4️⃣ Click Next to verify receiver\n5️⃣ Confirm the transfer\n\nTransfer is instant with no admin approval needed! 🚀\n\nNote: You need at least one active plan to transfer funds.';
            } else if (lowerMessage.includes('balance') || lowerMessage.includes('check') || lowerMessage.includes('wallet') || lowerMessage.includes('account')) {
                reply = '💰 Your balance is displayed on the Dashboard. You can view:\n\n• Total Balance\n• Today\'s Profit\n• Total Invested\n• Total Earned\n• Referral Bonus\n• Pending Deposits\n• Pending Withdrawals\n• Total Withdrawn';
            } else if (lowerMessage.includes('limit') || lowerMessage.includes('minimum') || lowerMessage.includes('maximum')) {
                reply = '📏 *Withdrawal Limits*\n\n• Minimum: PKR 30 per request\n• Maximum: PKR 500,000 per request\n• Daily Limit: PKR 100,000\n\nFund Transfer: No limit\n\nYou can submit as many withdrawal requests as you want!';
            } else if (lowerMessage.includes('plan list') || lowerMessage.includes('all plans') || lowerMessage.includes('packages') || lowerMessage.includes('available')) {
                reply = '📋 *Available Plans*\n\n1. Starter - PKR 360\n2. Silver - PKR 860\n3. Gold - PKR 1,460\n4. Platinum - PKR 2,660\n5. Diamond - PKR 4,260\n6. Ruby - PKR 6,060\n7. Emerald - PKR 9,060\n8. Sapphire - PKR 14,060\n9. Titanium - PKR 21,060\n10. Master - PKR 30,000\n11. Custom - PKR 50,000+\n\nAll plans: 11% daily profit for 60 days';
            } else if (lowerMessage.includes('password') || lowerMessage.includes('profile') || lowerMessage.includes('update') || lowerMessage.includes('change')) {
                reply = '👤 *Profile Management*\n\n1️⃣ Go to Profile page\n2️⃣ Update WhatsApp number\n3️⃣ Change password (leave blank to keep current)\n4️⃣ Upload profile picture\n5️⃣ Click Save Changes\n\nYour PID updates automatically when you change WhatsApp number.';
            } else if (lowerMessage.includes('support') || lowerMessage.includes('contact') || lowerMessage.includes('help') || lowerMessage.includes('admin')) {
                reply = '📞 *Support Options*\n\n1. Contact Admin: WhatsApp +258867532400\n2. Support Channel: Join our WhatsApp Channel\n3. Live Chat: AI Assistant on the website\n\nThe Support button is available on your Dashboard.';
            } else if (lowerMessage.includes('hi') || lowerMessage.includes('hello') || lowerMessage.includes('hey') || lowerMessage.includes('greetings')) {
                reply = 'Hello! 👋 Welcome to Profit 24 Support!\n\nI can help you with:\n• Investment Plans\n• Deposit Process\n• Withdrawals\n• Profit Calculations\n• Referral System\n• Fund Transfer\n• Account Management\n\nWhat would you like to know today? 💎';
            } else if (lowerMessage.includes('thank') || lowerMessage.includes('thanks') || lowerMessage.includes('appreciate')) {
                reply = 'You\'re welcome! 😊\n\nIf you need any further assistance, don\'t hesitate to ask. We\'re here to help you 24/7.\n\nHappy investing with Profit 24! 💎🚀';
            } else if (lowerMessage.includes('pid') || lowerMessage.includes('id') || lowerMessage.includes('code')) {
                reply = '🆔 *PID (Profit ID)*\n\n• Your PID is a unique 5-digit identifier\n• Generated from your WhatsApp number\n• Use it for Fund Transfers and Referrals\n• Find your PID on Dashboard or Profile page\n• Share your PID to earn referral bonuses!';
            } else if (lowerMessage.includes('multiple') || lowerMessage.includes('many') || lowerMessage.includes('several')) {
                reply = '✅ *Yes! You can have MULTIPLE active plans and submit MULTIPLE withdrawal requests!*\n\nThere are no restrictions on:\n• How many plans you can subscribe to\n• How many withdrawals you can request\n\nInvest in as many plans as you want and withdraw anytime!';
            } else {
                reply = 'I can answer questions about the Profit 24 platform.\n\nTry asking about:\n• How to invest?\n• What are the plans?\n• How much profit?\n• How to withdraw?\n• Referral bonus?\n• Fund transfer?\n• Account management?\n\nOr type "help" for support options.\n\nHow can I assist you today? 😊';
            }
        }

        res.json({
            success: true,
            reply: reply
        });

    } catch (error) {
        console.error('Chat Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Chat service unavailable'
        });
    }
});

// ============================================================
// DAILY PROFIT CRON JOB (Runs at midnight)
// ============================================================
cron.schedule('0 0 * * *', async function () {
    console.log('🕛 [CRON] Running daily profit distribution...');

    try {
        var users = await User.find({
            status: 'active',
            'activePlans.0': { $exists: true }  // Has at least one plan
        });

        var profitCount = 0;

        for (var i = 0; i < users.length; i++) {
            var user = users[i];

            if (user.activePlans && user.activePlans.length > 0) {
                var planModified = false;

                for (var j = 0; j < user.activePlans.length; j++) {
                    var plan = user.activePlans[j];

                    // Check if plan is still active (within 60 days and not expired)
                    if (plan.endDate >= new Date() && plan.profitDays < 60) {
                        // Add daily profit
                        user.balance += plan.dailyProfit;
                        user.totalEarned += plan.dailyProfit;
                        plan.profitDays += 1;
                        planModified = true;

                        // Record profit transaction
                        await new Transaction({
                            userId: user._id,
                            username: user.username,
                            type: 'profit',
                            amount: plan.dailyProfit,
                            status: 'approved'
                        }).save();

                        profitCount++;
                    }
                }

                // Save user if any plan was modified
                if (planModified) {
                    await user.save();
                }
            }
        }

        console.log('✅ [CRON] Daily profit distributed: ' + profitCount + ' plan(s) credited');

    } catch (error) {
        console.error('❌ [CRON] Profit distribution error:', error.message);
    }
});

console.log('⏰ [CRON] Daily profit job scheduled for midnight (00:00)');

// ============================================================
// DATABASE INITIALIZATION
// ============================================================
async function initializeDatabase() {
    console.log('📦 Initializing database...');

    try {
        // Initialize Plans
        var planCount = await Plan.countDocuments();
        if (planCount === 0) {
            console.log('   Creating default plans...');
            var defaultPlans = [
                { planId: 1, name: 'Starter', amount: 360, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 2, name: 'Silver', amount: 860, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 3, name: 'Gold', amount: 1460, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 4, name: 'Platinum', amount: 2660, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 5, name: 'Diamond', amount: 4260, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 6, name: 'Ruby', amount: 6060, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 7, name: 'Emerald', amount: 9060, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 8, name: 'Sapphire', amount: 14060, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 9, name: 'Titanium', amount: 21060, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 10, name: 'Master', amount: 30000, dailyProfit: 11, duration: 60, isActive: true },
                { planId: 11, name: 'Custom', amount: 50000, dailyProfit: 11, duration: 60, isActive: true }
            ];
            await Plan.insertMany(defaultPlans);
            console.log('   ✅ 11 plans created');
        }

        // Initialize Settings
        var settingsCount = await Setting.countDocuments();
        if (settingsCount === 0) {
            console.log('   Creating default settings...');
            var defaultSettings = [
                { key: 'referralBonus', value: 11 },
                { key: 'minWithdraw', value: 30 },
                { key: 'maxWithdraw', value: 500000 },
                { key: 'maxDailyWithdraw', value: 100000 },
                { key: 'easypaisaNumber', value: '03000000000' },
                { key: 'easypaisaTitle', value: 'Profit 24' },
                { key: 'jazzcashNumber', value: '03000000000' },
                { key: 'jazzcashTitle', value: 'Profit 24' },
                { key: 'depositEnabled', value: true },
                { key: 'withdrawEnabled', value: true },
                { key: 'fundTransferEnabled', value: true },
                { key: 'fundTransferFee', value: 0 }
            ];
            await Setting.insertMany(defaultSettings);
            console.log('   ✅ 12 settings created');
        }

        // Initialize FAQs
        var faqCount = await FAQ.countDocuments();
        if (faqCount === 0) {
            console.log('   Creating default FAQs...');
            var defaultFaqs = [
                {
                    question: 'What is Profit 24?',
                    answer: 'Profit 24 is a secure investment platform where you can invest and earn 11% daily profit for 60 days. We offer 11 different plans starting from PKR 360 to PKR 50,000+.',
                    order: 1
                },
                {
                    question: 'How to invest?',
                    answer: '1) Go to Deposit page 2) Select a plan 3) Choose Easypaisa or JazzCash 4) Send payment to given account 5) Upload screenshot with Transaction ID 6) Wait for admin approval.',
                    order: 2
                },
                {
                    question: 'How does referral work?',
                    answer: 'Share your PID code. When someone joins using your referral and makes a deposit, you earn 11% bonus instantly. Example: If they invest PKR 10,000, you get PKR 1,100.',
                    order: 3
                },
                {
                    question: 'Minimum withdrawal?',
                    answer: 'PKR 30 minimum withdrawal. Maximum PKR 500,000 per request. You can submit multiple withdrawal requests.',
                    order: 4
                },
                {
                    question: 'Can I have multiple plans?',
                    answer: 'Yes! You can subscribe to as many investment plans as you want simultaneously. Each plan runs for 60 days with 11% daily profit.',
                    order: 5
                }
            ];
            await FAQ.insertMany(defaultFaqs);
            console.log('   ✅ 5 FAQs created');
        }

        console.log('📦 Database initialization complete!');

    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
    }
}

// ============================================================
// START SERVER
// ============================================================
mongoose.connect(MONGODB_URI)
    .then(async function () {
        console.log('✅ MongoDB connected successfully');
        console.log('📦 Database: ' + mongoose.connection.db.databaseName);

        // Initialize database with default data
        await initializeDatabase();

        // Initialize Telegram bot
        initTelegramBot();

        // Start Express server
        app.listen(PORT, function () {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🚀 Profit 24 Server Started!');
            console.log('📡 Port: ' + PORT);
            console.log('🌐 URL: http://localhost:' + PORT);
            console.log('📱 API: http://localhost:' + PORT + '/api/health');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });
    })
    .catch(function (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        process.exit(1);
    });

// Handle uncaught errors
process.on('uncaughtException', function (error) {
    console.error('❌ Uncaught Exception:', error.message);
});

process.on('unhandledRejection', function (error) {
    console.error('❌ Unhandled Rejection:', error.message);
});
