import os
import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes

API_URL = "https://your-app.herokuapp.com"
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
ADMIN_ID = os.getenv("TELEGRAM_ADMIN_ID")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if str(update.effective_user.id) != ADMIN_ID:
        return
    
    keyboard = [
        [InlineKeyboardButton("📊 Dashboard Stats", callback_data="dashboard")],
        [InlineKeyboardButton("👥 Users Management", callback_data="users")],
        [InlineKeyboardButton("💰 Pending Deposits", callback_data="deposits")],
        [InlineKeyboardButton("💸 Pending Withdrawals", callback_data="withdrawals")],
        [InlineKeyboardButton("⚙️ Settings", callback_data="settings")],
        [InlineKeyboardButton("📢 Broadcast Message", callback_data="broadcast")],
        [InlineKeyboardButton("❓ FAQ Management", callback_data="faq")]
    ]
    
    await update.message.reply_text(
        "🔐 Admin Panel\n\nWelcome! Select an option:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    if query.data == "dashboard":
        # Fetch dashboard stats from API
        stats = requests.get(f"{API_URL}/api/dashboard").json()
        await query.edit_message_text(
            f"📊 Dashboard Stats\n\n"
            f"Total Users: {stats.get('totalUsers', 'N/A')}\n"
            f"Active Investments: {stats.get('activeInvestments', 'N/A')}\n"
            f"Total Deposits: PKR {stats.get('totalDeposits', 'N/A')}"
        )
    
    elif query.data == "deposits":
        deposits = requests.get(f"{API_URL}/api/admin/pending-deposits").json()
        if not deposits:
            await query.edit_message_text("No pending deposits")
            return
        
        for dep in deposits:
            keyboard = [
                [
                    InlineKeyboardButton("✅ Approve", callback_data=f"approve_dep_{dep['_id']}"),
                    InlineKeyboardButton("❌ Reject", callback_data=f"reject_dep_{dep['_id']}")
                ]
            ]
            await context.bot.send_message(
                chat_id=ADMIN_ID,
                text=f"💰 Pending Deposit\n\nUser: {dep['username']}\nAmount: PKR {dep['amount']}\nTxID: {dep['txId']}",
                reply_markup=InlineKeyboardMarkup(keyboard)
            )
    
    elif query.data == "withdrawals":
        withdrawals = requests.get(f"{API_URL}/api/admin/pending-withdrawals").json()
        if not withdrawals:
            await query.edit_message_text("No pending withdrawals")
            return
        
        for wd in withdrawals:
            keyboard = [
                [
                    InlineKeyboardButton("✅ Approve", callback_data=f"approve_wd_{wd['_id']}"),
                    InlineKeyboardButton("❌ Reject", callback_data=f"reject_wd_{wd['_id']}")
                ]
            ]
            await context.bot.send_message(
                chat_id=ADMIN_ID,
                text=f"💸 Pending Withdrawal\n\nUser: {wd['username']}\nAmount: PKR {wd['amount']}\nAccount: {wd['accountType']} - {wd['accountNumber']}",
                reply_markup=InlineKeyboardMarkup(keyboard)
            )
    
    elif "approve_dep" in query.data or "reject_dep" in query.data:
        tid = query.data.split("_")[-1]
        action = "approved" if "approve" in query.data else "rejected"
        requests.post(f"{API_URL}/api/admin/deposit-action", json={
            "transactionId": tid,
            "action": action
        })
        await query.edit_message_text(f"Deposit {action} successfully!")
    
    elif "approve_wd" in query.data or "reject_wd" in query.data:
        tid = query.data.split("_")[-1]
        action = "approved" if "approve" in query.data else "rejected"
        requests.post(f"{API_URL}/api/admin/withdraw-action", json={
            "transactionId": tid,
            "action": action
        })
        await query.edit_message_text(f"Withdrawal {action} successfully!")

def main():
    application = Application.builder().token(BOT_TOKEN).build()
    
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("admin", start))
    application.add_handler(CallbackQueryHandler(button_handler))
    
    application.run_polling()

if __name__ == "__main__":
    main()
