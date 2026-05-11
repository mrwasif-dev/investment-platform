const API_URL = '';
let token = localStorage.getItem('token');
let currentPlan = null;

// Auth functions
function showSignup() {
    document.getElementById('signin-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'block';
}

function showSignin() {
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('signin-form').style.display = 'block';
}

async function signup() {
    const data = {
        username: document.getElementById('signup-username').value,
        whatsapp: document.getElementById('signup-whatsapp').value,
        password: document.getElementById('signup-password').value,
        referralCode: document.getElementById('signup-referral').value
    };

    try {
        const res = await fetch(`${API_URL}/api/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        
        if (res.ok) {
            localStorage.setItem('token', result.token);
            token = result.token;
            showDashboard();
            notify('Registration successful!', 'success');
        } else {
            notify(result.error, 'error');
        }
    } catch (err) {
        notify('Error: ' + err.message, 'error');
    }
}

async function login() {
    const data = {
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value
    };

    try {
        const res = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        
        if (res.ok) {
            localStorage.setItem('token', result.token);
            token = result.token;
            showDashboard();
            notify('Login successful!', 'success');
        } else {
            notify(result.error, 'error');
        }
    } catch (err) {
        notify('Error: ' + err.message, 'error');
    }
}

function logout() {
    localStorage.removeItem('token');
    token = null;
    hideAllSections();
    document.getElementById('auth-section').style.display = 'block';
    document.getElementById('signin-form').style.display = 'block';
    document.getElementById('signup-form').style.display = 'none';
}

// Show/Hide sections
function hideAllSections() {
    const sections = [
        'auth-section', 'dashboard-section', 'plans-section',
        'withdraw-section', 'history-section', 'leaderboard-section',
        'faq-section'
    ];
    sections.forEach(id => document.getElementById(id).style.display = 'none');
}

function goBack() {
    showDashboard();
}

async function showDashboard() {
    hideAllSections();
    document.getElementById('dashboard-section').style.display = 'block';
    
    try {
        const res = await fetch(`${API_URL}/api/dashboard`, {
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        
        document.getElementById('welcome-msg').textContent = `Welcome, ${data.username}`;
        document.getElementById('user-balance').textContent = data.balance.toFixed(2);
        document.getElementById('referral-link').textContent = 
            `${window.location.origin}?ref=${data.referralCode}`;
    } catch (err) {
        notify('Error loading dashboard', 'error');
    }
}

async function showPlans() {
    hideAllSections();
    document.getElementById('plans-section').style.display = 'block';
    
    try {
        const res = await fetch(`${API_URL}/api/plans`, {
            headers: { 'Authorization': token }
        });
        const plans = await res.json();
        
        const plansHTML = plans.map(plan => `
            <div class="plan-card" onclick="selectPlan(${plan.planId}, ${plan.amount})">
                <h3>${plan.name}</h3>
                <p>Amount: PKR ${plan.amount}</p>
                <p>Daily Profit: ${plan.dailyProfit}%</p>
                <p>Duration: ${plan.duration} Days</p>
                <p>Total Return: PKR ${(plan.amount * (plan.dailyProfit/100) * plan.duration).toFixed(2)}</p>
            </div>
        `).join('');
        
        document.getElementById('plans-list').innerHTML = plansHTML;
    } catch (err) {
        notify('Error loading plans', 'error');
    }
}

function selectPlan(planId, amount) {
    currentPlan = { planId, amount };
    document.getElementById('selected-plan-amount').textContent = amount;
    document.getElementById('deposit-form').style.display = 'block';
    
    // Highlight selected plan
    document.querySelectorAll('.plan-card').forEach(card => card.classList.remove('selected'));
    event.target.closest('.plan-card').classList.add('selected');
}

async function showDepositAccount() {
    const accountType = document.getElementById('account-type').value;
    if (!accountType) return;
    
    try {
        const res = await fetch(`${API_URL}/api/deposit-accounts`, {
            headers: { 'Authorization': token }
        });
        const accounts = await res.json();
        
        const account = accounts[accountType];
        document.getElementById('account-details').style.display = 'block';
        document.getElementById('account-details').innerHTML = `
            <p>Account Type: ${accountType}</p>
            <p>Account Number: ${account.number} 
                <button onclick="copyText('${account.number}')" style="width: auto; padding: 5px;">Copy</button>
            </p>
            <p>Account Title: ${account.title}</p>
        `;
    } catch (err) {
        notify('Error loading account details', 'error');
    }
}

async function submitDeposit() {
    if (!currentPlan) return notify('Please select a plan', 'error');
    
    const formData = new FormData();
    formData.append('planId', currentPlan.planId);
    formData.append('accountType', document.getElementById('account-type').value);
    formData.append('txId', document.getElementById('tx-id').value);
    formData.append('screenshot', document.getElementById('screenshot').files[0]);
    
    try {
        const res = await fetch(`${API_URL}/api/deposit`, {
            method: 'POST',
            headers: { 'Authorization': token },
            body: formData
        });
        const result = await res.json();
        
        if (res.ok) {
            notify('Deposit submitted successfully!', 'success');
            showDashboard();
        } else {
            notify(result.error, 'error');
        }
    } catch (err) {
        notify('Error: ' + err.message, 'error');
    }
}

function showWithdraw() {
    hideAllSections();
    document.getElementById('withdraw-section').style.display = 'block';
}

async function submitWithdraw() {
    const data = {
        accountType: document.getElementById('withdraw-account-type').value,
        accountNumber: document.getElementById('withdraw-account-number').value,
        accountTitle: document.getElementById('withdraw-account-title').value,
        amount: parseFloat(document.getElementById('withdraw-amount').value)
    };
    
    try {
        const res = await fetch(`${API_URL}/api/withdraw`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token
            },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        
        if (res.ok) {
            notify('Withdrawal request submitted!', 'success');
            showDashboard();
        } else {
            notify(result.error, 'error');
        }
    } catch (err) {
        notify('Error: ' + err.message, 'error');
    }
}

async function viewMyPlan() {
    try {
        const res = await fetch(`${API_URL}/api/dashboard`, {
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        
        if (data.activePlan) {
            notify(`Active Plan: ${data.activePlan.planId}\nDaily Profit: PKR ${data.activePlan.dailyProfit}\nDays Remaining: ${60 - data.activePlan.profitDays}`, 'success');
        } else {
            notify('No active plan. Please invest first.', 'error');
        }
    } catch (err) {
        notify('Error', 'error');
    }
}

async function viewDeposits() {
    hideAllSections();
    document.getElementById('history-section').style.display = 'block';
    document.getElementById('history-title').textContent = 'Deposit History';
    
    try {
        const res = await fetch(`${API_URL}/api/deposits`, {
            headers: { 'Authorization': token }
        });
        const deposits = await res.json();
        
        const html = deposits.map(d => `
            <div class="history-item">
                <p>Amount: PKR ${d.amount}</p>
                <p>Status: ${d.status}</p>
                <p>Date: ${new Date(d.createdAt).toLocaleDateString('ur-PK')}</p>
            </div>
        `).join('');
        
        document.getElementById('history-content').innerHTML = html || '<p>No deposits found</p>';
    } catch (err) {
        notify('Error loading deposits', 'error');
    }
}

async function viewWithdrawals() {
    hideAllSections();
    document.getElementById('history-section').style.display = 'block';
    document.getElementById('history-title').textContent = 'Withdrawal History';
    
    try {
        const res = await fetch(`${API_URL}/api/withdrawals`, {
            headers: { 'Authorization': token }
        });
        const withdrawals = await res.json();
        
        const html = withdrawals.map(w => `
            <div class="history-item">
                <p>Amount: PKR ${w.amount}</p>
                <p>Account: ${w.accountType} - ${w.accountNumber}</p>
                <p>Status: ${w.status}</p>
                <p>Date: ${new Date(w.createdAt).toLocaleDateString('ur-PK')}</p>
            </div>
        `).join('');
        
        document.getElementById('history-content').innerHTML = html || '<p>No withdrawals found</p>';
    } catch (err) {
        notify('Error loading withdrawals', 'error');
    }
}

async function viewTransactions() {
    hideAllSections();
    document.getElementById('history-section').style.display = 'block';
    document.getElementById('history-title').textContent = 'Transaction History';
    
    try {
        const res = await fetch(`${API_URL}/api/transactions`, {
            headers: { 'Authorization': token }
        });
        const transactions = await res.json();
        
        const html = transactions.map(t => `
            <div class="history-item">
                <p>Type: ${t.type}</p>
                <p>Amount: PKR ${t.amount}</p>
                <p>Status: ${t.status}</p>
                <p>Date: ${new Date(t.createdAt).toLocaleDateString('ur-PK')}</p>
            </div>
        `).join('');
        
        document.getElementById('history-content').innerHTML = html || '<p>No transactions found</p>';
    } catch (err) {
        notify('Error loading transactions', 'error');
    }
}

async function viewTeam() {
    hideAllSections();
    document.getElementById('history-section').style.display = 'block';
    document.getElementById('history-title').textContent = 'My Team';
    
    try {
        const res = await fetch(`${API_URL}/api/team`, {
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        
        const html = data.team.map(member => `
            <div class="history-item">
                <p>Username: ${member.username}</p>
                <p>Total Invested: PKR ${member.totalInvested}</p>
                <p>Joined: ${new Date(member.joinedAt).toLocaleDateString('ur-PK')}</p>
            </div>
        `).join('');
        
        document.getElementById('history-content').innerHTML = 
            `<p>Total Team Members: ${data.teamCount}</p>${html}`;
    } catch (err) {
        notify('Error loading team', 'error');
    }
}

async function viewLeaderboard() {
    hideAllSections();
    document.getElementById('leaderboard-section').style.display = 'block';
    
    try {
        const res = await fetch(`${API_URL}/api/leaderboard`, {
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        
        const investorsHTML = data.topInvestors.map((user, i) => `
            <div class="history-item">
                <p>${i + 1}. ${user.username} - PKR ${user.totalInvested}</p>
            </div>
        `).join('');
        
        const referrersHTML = data.topReferrers.map((user, i) => `
            <div class="history-item">
                <p>${i + 1}. ${user.username} - ${user.referralCount} referrals</p>
            </div>
        `).join('');
        
        document.getElementById('top-investors').innerHTML = investorsHTML;
        document.getElementById('top-referrers').innerHTML = referrersHTML;
    } catch (err) {
        notify('Error loading leaderboard', 'error');
    }
}

async function viewFAQs() {
    hideAllSections();
    document.getElementById('faq-section').style.display = 'block';
    
    try {
        const res = await fetch(`${API_URL}/api/faqs`);
        const faqs = await res.json();
        
        const html = faqs.map(faq => `
            <div class="history-item">
                <h3>${faq.question}</h3>
                <p>${faq.answer}</p>
            </div>
        `).join('');
        
        document.getElementById('faq-list').innerHTML = html || '<p>No FAQs available</p>';
    } catch (err) {
        notify('Error loading FAQs', 'error');
    }
}

function copyReferral() {
    const link = document.getElementById('referral-link').textContent;
    navigator.clipboard.writeText(link);
    notify('Referral link copied!', 'success');
}

function copyText(text) {
    navigator.clipboard.writeText(text);
    notify('Copied!', 'success');
}

function notify(message, type) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    setTimeout(() => notification.style.display = 'none', 3000);
}

// Check if user is logged in
if (token) {
    showDashboard();
}
