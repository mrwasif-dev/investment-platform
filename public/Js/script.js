// ============================================================
// PROFIT 24 - COMPLETE FRONTEND SCRIPT
// ============================================================

const API_BASE = '';
let authToken = localStorage.getItem('profit24_token') || null;
let currentPlan = null;
let depositAccounts = null;

// ============ UTILITY FUNCTIONS ============

function $(selector) {
    return document.getElementById(selector);
}

function showToast(message, type = 'info') {
    const toast = $('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type;
    toast.style.display = 'block';
    setTimeout(function() {
        toast.style.display = 'none';
    }, 3500);
}

function showSection(sectionId) {
    const sections = [
        'authSection', 'dashboardSection', 'plansSection',
        'withdrawSection', 'historySection', 'leaderboardSection', 'faqSection'
    ];
    sections.forEach(function(id) {
        const el = $(id);
        if (el) el.classList.add('hidden');
    });
    const target = $(sectionId);
    if (target) target.classList.remove('hidden');
}

function formatCurrency(amount) {
    return Number(amount || 0).toLocaleString('ur-PK');
}

// ============ AUTH FUNCTIONS ============

function showSignupForm() {
    $('loginCard').classList.add('hidden');
    $('signupCard').classList.remove('hidden');
}

function showLoginForm() {
    $('signupCard').classList.add('hidden');
    $('loginCard').classList.remove('hidden');
}

async function handleSignup() {
    const username = $('signupUsername').value.trim();
    const whatsapp = $('signupWhatsapp').value.trim();
    const password = $('signupPassword').value.trim();
    const referralCode = $('signupReferral').value.trim();

    if (!username || !whatsapp || !password) {
        return showToast('Please fill all required fields', 'error');
    }

    if (password.length < 6) {
        return showToast('Password must be at least 6 characters', 'error');
    }

    try {
        const response = await fetch(API_BASE + '/api/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, whatsapp, password, referralCode })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            authToken = data.token;
            localStorage.setItem('profit24_token', authToken);
            showSection('dashboardSection');
            loadDashboard();
            showToast('Account created successfully! 🎉', 'success');
        } else {
            showToast(data.error || 'Registration failed', 'error');
        }
    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    }
}

async function handleLogin() {
    const username = $('loginUsername').value.trim();
    const password = $('loginPassword').value.trim();

    if (!username || !password) {
        return showToast('Please enter username and password', 'error');
    }

    try {
        const response = await fetch(API_BASE + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            authToken = data.token;
            localStorage.setItem('profit24_token', authToken);
            showSection('dashboardSection');
            loadDashboard();
            showToast('Welcome back! 👋', 'success');
        } else {
            showToast(data.error || 'Login failed', 'error');
        }
    } catch (error) {
        showToast('Network error. Please try again.', 'error');
    }
}

function handleLogout() {
    localStorage.removeItem('profit24_token');
    authToken = null;
    showSection('authSection');
    showLoginForm();
    showToast('Logged out successfully', 'info');
}

// ============ NAVIGATION ============

function goToDashboard() {
    showSection('dashboardSection');
    loadDashboard();
}

function navigateTo(page) {
    if (page === 'plans') {
        showSection('plansSection');
        loadPlans();
    } else if (page === 'withdraw') {
        showSection('withdrawSection');
    } else if (page === 'deposits') {
        showSection('historySection');
        loadHistory('deposits');
    } else if (page === 'withdrawals') {
        showSection('historySection');
        loadHistory('withdrawals');
    } else if (page === 'transactions') {
        showSection('historySection');
        loadHistory('all');
    } else if (page === 'team') {
        showSection('historySection');
        loadTeam();
    } else if (page === 'leaderboard') {
        showSection('leaderboardSection');
        loadLeaderboard();
    } else if (page === 'faqs') {
        showSection('faqSection');
        loadFAQs();
    }
}

// ============ DASHBOARD ============

async function loadDashboard() {
    try {
        const response = await fetch(API_BASE + '/api/dashboard', {
            headers: { 'Authorization': authToken }
        });
        const data = await response.json();

        if (data.success) {
            $('dashUsername').textContent = '👋 Welcome, ' + data.username;
            $('dashBalance').textContent = (data.balance || 0).toFixed(2);
            $('statToday').textContent = 'PKR ' + formatCurrency(data.todayProfit);
            $('statInvested').textContent = 'PKR ' + formatCurrency(data.totalInvested);
            $('statEarned').textContent = 'PKR ' + formatCurrency(data.totalEarned);
            $('statRefs').textContent = data.referralCount || 0;
            $('referralLink').textContent = window.location.origin + '?ref=' + data.referralCode;
        }
    } catch (error) {
        showToast('Error loading dashboard', 'error');
    }
}

// ============ PLANS ============

async function loadPlans() {
    try {
        const response = await fetch(API_BASE + '/api/plans', {
            headers: { 'Authorization': authToken }
        });
        const data = await response.json();

        if (data.success) {
            $('plansGrid').innerHTML = data.plans.map(function(plan) {
                const totalReturn = plan.amount * (plan.dailyProfit / 100) * plan.duration;
                return `
                    <div class="plan-card" onclick="selectPlan(${plan.planId}, ${plan.amount}, '${plan.name}')">
                        <div class="plan-name">${plan.name}</div>
                        <div class="plan-amount">PKR ${formatCurrency(plan.amount)}</div>
                        <div class="plan-info">📈 ${plan.dailyProfit}% Daily | 📅 ${plan.duration} Days</div>
                        <div class="plan-info">💎 Total Return: PKR ${formatCurrency(totalReturn)}</div>
                    </div>
                `;
            }).join('');
        }
    } catch (error) {
        showToast('Error loading plans', 'error');
    }
}

function selectPlan(planId, amount, name) {
    currentPlan = { id: planId, amount: amount, name: name };

    document.querySelectorAll('.plan-card').forEach(function(card) {
        card.classList.remove('selected');
    });
    event.target.closest('.plan-card').classList.add('selected');

    $('selectedPlanName').textContent = name;
    $('selectedPlanAmount').textContent = formatCurrency(amount);
    $('depositForm').classList.remove('hidden');
    $('depositForm').scrollIntoView({ behavior: 'smooth' });
}

async function showAccountDetails() {
    const accountType = $('accountType').value;
    if (!accountType) return;

    if (!depositAccounts) {
        try {
            const response = await fetch(API_BASE + '/api/deposit-accounts', {
                headers: { 'Authorization': authToken }
            });
            const data = await response.json();
            if (data.success) {
                depositAccounts = data;
            }
        } catch (error) {
            showToast('Error loading account details', 'error');
            return;
        }
    }

    const account = depositAccounts[accountType];
    $('accountDetails').classList.remove('hidden');
    $('accountDetails').innerHTML = `
        <div class="form-card" style="margin-top:10px;">
            <p style="margin:8px 0;">📱 <strong>${accountType.toUpperCase()}</strong></p>
            <p style="margin:8px 0;">🔢 Number: <strong>${account.number}</strong>
                <button class="btn-sm" onclick="copyToClipboard('${account.number}')" style="padding:4px 10px;">📋 Copy</button>
            </p>
            <p style="margin:8px 0;">📛 Title: <strong>${account.title}</strong></p>
        </div>
    `;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
    showToast('Copied! 📋', 'success');
}

async function submitDeposit() {
    if (!currentPlan) return showToast('Select a plan first!', 'error');
    if (!$('accountType').value) return showToast('Select payment method', 'error');
    if (!$('transactionId').value) return showToast('Enter Transaction ID', 'error');
    if (!$('screenshotFile').files[0]) return showToast('Upload screenshot', 'error');

    const formData = new FormData();
    formData.append('planId', currentPlan.id);
    formData.append('accountType', $('accountType').value);
    formData.append('txId', $('transactionId').value);
    formData.append('screenshot', $('screenshotFile').files[0]);

    try {
        const response = await fetch(API_BASE + '/api/deposit', {
            method: 'POST',
            headers: { 'Authorization': authToken },
            body: formData
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Deposit submitted! Awaiting approval. ✅', 'success');
            goToDashboard();
        } else {
            showToast(data.error || 'Deposit failed', 'error');
        }
    } catch (error) {
        showToast('Error submitting deposit', 'error');
    }
}

// ============ WITHDRAW ============

async function submitWithdrawal() {
    const accountType = $('wdAccountType').value;
    const accountNumber = $('wdAccountNumber').value.trim();
    const accountTitle = $('wdAccountTitle').value.trim();
    const amount = parseFloat($('wdAmount').value);

    if (!accountType || !accountNumber || !accountTitle || !amount) {
        return showToast('All fields are required', 'error');
    }

    if (amount < 30) {
        return showToast('Minimum withdrawal is PKR 30', 'error');
    }

    try {
        const response = await fetch(API_BASE + '/api/withdraw', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authToken
            },
            body: JSON.stringify({ accountType, accountNumber, accountTitle, amount })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Withdrawal submitted! Awaiting approval. ✅', 'success');
            goToDashboard();
        } else {
            showToast(data.error || 'Withdrawal failed', 'error');
        }
    } catch (error) {
        showToast('Error submitting withdrawal', 'error');
    }
}

// ============ VIEW PLAN ============

async function viewActivePlan() {
    try {
        const response = await fetch(API_BASE + '/api/dashboard', {
            headers: { 'Authorization': authToken }
        });
        const data = await response.json();

        if (data.success && data.activePlan) {
            const plan = data.activePlan;
            showToast(
                '📋 ' + plan.name + '\n' +
                '💰 Daily: PKR ' + plan.dailyProfit.toFixed(2) + '\n' +
                '📅 Day: ' + plan.profitDays + '/60\n' +
                '💵 Remaining: ' + (60 - plan.profitDays) + ' days',
                'info'
            );
        } else {
            showToast('No active plan. Please invest first.', 'error');
        }
    } catch (error) {
        showToast('Error checking plan', 'error');
    }
}

// ============ HISTORY ============

async function loadHistory(type) {
    let title, url;

    if (type === 'deposits') {
        title = '📥 Deposit History';
        url = '/api/deposits';
    } else if (type === 'withdrawals') {
        title = '📤 Withdrawal History';
        url = '/api/withdrawals';
    } else {
        title = '📊 All Transactions';
        url = '/api/transactions';
    }

    $('historyTitle').textContent = title;

    try {
        const response = await fetch(API_BASE + url, {
            headers: { 'Authorization': authToken }
        });
        const data = await response.json();

        const items = data.deposits || data.withdrawals || data.transactions || [];

        if (items.length === 0) {
            $('historyContent').innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:30px;">No records found</p>';
            return;
        }

        $('historyContent').innerHTML = items.map(function(item) {
            const statusClass = item.status === 'approved' ? 'approved' : (item.status === 'rejected' ? 'rejected' : 'pending');
            const statusColor = item.status === 'approved' ? '#4ade80' : (item.status === 'rejected' ? '#f87171' : '#fbbf24');

            return `
                <div class="history-item ${statusClass}">
                    <strong>${item.type.toUpperCase()}</strong> | 
                    PKR ${formatCurrency(item.amount)} | 
                    <span style="color:${statusColor}">${item.status}</span>
                    <br>
                    <small>${new Date(item.createdAt).toLocaleString('ur-PK')}</small>
                </div>
            `;
        }).join('');
    } catch (error) {
        showToast('Error loading history', 'error');
    }
}

// ============ TEAM ============

async function loadTeam() {
    $('historyTitle').textContent = '👥 My Team';

    try {
        const response = await fetch(API_BASE + '/api/team', {
            headers: { 'Authorization': authToken }
        });
        const data = await response.json();

        let html = '<p style="margin-bottom:20px;font-size:18px;">👥 Total Members: <strong>' + data.teamCount + '</strong></p>';

        if (data.team.length === 0) {
            html += '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:30px;">No team members yet</p>';
        } else {
            html += data.team.map(function(member) {
                return `
                    <div class="history-item">
                        <strong>${member.username}</strong> | 
                        💰 PKR ${formatCurrency(member.totalInvested)} | 
                        📅 ${new Date(member.createdAt).toLocaleDateString()}
                    </div>
                `;
            }).join('');
        }

        $('historyContent').innerHTML = html;
    } catch (error) {
        showToast('Error loading team', 'error');
    }
}

// ============ LEADERBOARD ============

async function loadLeaderboard() {
    try {
        const response = await fetch(API_BASE + '/api/leaderboard', {
            headers: { 'Authorization': authToken }
        });
        const data = await response.json();

        $('topInvestors').innerHTML = data.topInvestors.length > 0
            ? data.topInvestors.map(function(user, index) {
                return '<div class="history-item" style="animation-delay:' + (index * 0.05) + 's;">' +
                    (index + 1) + '. 🏅 <strong>' + user.username + '</strong> - PKR ' + formatCurrency(user.totalInvested) +
                    '</div>';
            }).join('')
            : '<p>No data available</p>';

        $('topReferrers').innerHTML = data.topReferrers.length > 0
            ? data.topReferrers.map(function(user, index) {
                return '<div class="history-item" style="animation-delay:' + (index * 0.05) + 's;">' +
                    (index + 1) + '. 🔗 <strong>' + user.username + '</strong> - ' + (user.count || 0) + ' referrals' +
                    '</div>';
            }).join('')
            : '<p>No data available</p>';
    } catch (error) {
        showToast('Error loading leaderboard', 'error');
    }
}

// ============ FAQS ============

async function loadFAQs() {
    try {
        const response = await fetch(API_BASE + '/api/faqs');
        const data = await response.json();

        if (data.faqs && data.faqs.length > 0) {
            $('faqList').innerHTML = data.faqs.map(function(faq, index) {
                return `
                    <div class="form-card" style="margin:14px 0;animation:fadeIn 0.4s ease;animation-delay:${index * 0.08}s;">
                        <h3 style="color:#a78bfa;margin-bottom:10px;">❓ ${faq.question}</h3>
                        <p style="color:rgba(255,255,255,0.7);line-height:1.6;">${faq.answer}</p>
                    </div>
                `;
            }).join('');
        } else {
            $('faqList').innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.5);padding:30px;">No FAQs available</p>';
        }
    } catch (error) {
        showToast('Error loading FAQs', 'error');
    }
}

// ============ REFERRAL ============

function copyReferral() {
    const link = $('referralLink').textContent;
    navigator.clipboard.writeText(link);
    showToast('Referral link copied! 📋', 'success');
}

// ============ INIT ============

(function init() {
    if (authToken) {
        showSection('dashboardSection');
        loadDashboard();
    } else {
        showSection('authSection');
        showLoginForm();
    }
})();
