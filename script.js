// Application entry: UI wiring, settings and history.
import { state, el, STORAGE_KEYS, DICE_TYPES, HISTORY_LIMIT, normalizeDiceSettings, saveJSON, clamp } from "./js/shared.js?v=20261021-2";
import { createDiceController } from "./js/dice.js?v=20261021-2";
import { createCoinController } from "./js/coin.js?v=20261021-2";

const dice = createDiceController({ completeDiceRoll, setRollingUI });
const coin = createCoinController({ dice, completeCoinToss, setTossingUI });
const { state: dice3d, renderDiceStage, resizeDiceRenderer, renderDiceFrame, rollDice } = dice;
const { state: coin3d, renderCoinStage, ensureCoinEngine, resizeCoinRenderer, updateCoinEmphasis, tossCoin } = coin;

function cacheEls() {
    el.tabBtns = document.querySelectorAll(".tab-btn");
    el.panels = document.querySelectorAll(".panel");
    el.settingsBtn = document.getElementById("settingsBtn");

    el.diceStage = document.getElementById("diceStage");
    el.diceResultArea = document.getElementById("diceResultArea");
    el.rollBtn = document.getElementById("rollBtn");
    el.diceHistoryList = document.getElementById("diceHistoryList");

    el.coinStage = document.getElementById("coinStage");
    el.coinResultArea = document.getElementById("coinResultArea");
    el.tossBtn = document.getElementById("tossBtn");
    el.coinHistoryList = document.getElementById("coinHistoryList");

    el.settingsModal = document.getElementById("settingsModal");
    el.settingsBodyDice = document.querySelector('.modal-body[data-settings="dice"]');
    el.settingsBodyCoin = document.querySelector('.modal-body[data-settings="coin"]');
    el.diceCountRow = document.getElementById("diceCountRow");
    el.diceCountValue = document.getElementById("diceCountValue");
    el.diceTypeBtns = document.querySelectorAll(".dice-type-btn");
    el.coinCountValue = document.getElementById("coinCountValue");
    el.coinEmphasizeSides = document.getElementById("coinEmphasizeSides");
    el.settingsCancelBtn = document.getElementById("settingsCancelBtn");
    el.settingsConfirmBtn = document.getElementById("settingsConfirmBtn");

    el.confirmDialog = document.getElementById("confirmDialog");
    el.confirmCancelBtn = document.getElementById("confirmCancelBtn");
    el.confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
}

function init() {
    cacheEls();

    renderDiceStage();
    renderCoinStage();
    renderHistory("dice");
    renderHistory("coin");

    bindTabEvents();
    bindActionEvents();
    bindSettingsEvents();
    bindClearEvents();

    setupAdHeightSync();

    dice.start();

    console.log("DICE & COIN initialized");
}

function setupAdHeightSync() {
    const adBanner = document.querySelector(".ad-banner");
    if (!adBanner) return;

    const applyHeight = () => {
        const h = adBanner.offsetHeight;
        if (h > 0) {
            document.documentElement.style.setProperty("--ad-height", `${h}px`);
        }
    };

    applyHeight();

    if (window.ResizeObserver) {
        const observer = new ResizeObserver(applyHeight);
        observer.observe(adBanner);
    }

    // 広告の外部スクリプトは非同期で読み込まれ、直後は高さが0の場合があるため
    // 読み込み後の複数タイミングで再計測してフォールバックする。
    [300, 800, 1500, 3000].forEach((delay) => setTimeout(applyHeight, delay));
}

function bindTabEvents() {
    el.tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;
            switchTab(target);
        });
    });
}

function switchTab(target) {
    el.tabBtns.forEach((btn) => {
        const isActive = btn.dataset.tab === target;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-selected", String(isActive));
    });
    el.panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === target);
    });

    if (target === "dice" && dice3d.status === "ready") {
        requestAnimationFrame(() => {
            resizeDiceRenderer();
            renderDiceFrame();
        });
    }
    if (target === "coin") {
        ensureCoinEngine().then(() => {
            if (coin3d.status === "ready") resizeCoinRenderer();
        });
    }
}

function getActiveTab() {
    const activeBtn = document.querySelector(".tab-btn.is-active");
    return activeBtn ? activeBtn.dataset.tab : "dice";
}

function bindActionEvents() {
    el.rollBtn.addEventListener("click", rollDice);
    el.tossBtn.addEventListener("click", tossCoin);
}

function completeDiceRoll(results) {
    showDiceResult(results);
    pushDiceHistory(results);
    state.isRolling = false;
    setRollingUI(false);
}

function showDiceResult(results) {
    const total = results.reduce((sum, v) => sum + v, 0);
    const valuesHtml = results.map((v) => `<span>${v}</span>`).join("");
    if (state.diceSettings.faces === 100) {
        el.diceResultArea.innerHTML = `
            <div class="result-values result-values--percentile"><span>${results[0]}</span></div>
            <div class="result-total">D100</div>
        `;
        return;
    }
    el.diceResultArea.innerHTML = `
        <div class="result-values">${valuesHtml}</div>
        <div class="result-total">合計 <strong>${total}</strong></div>
    `;
}

function pushDiceHistory(results) {
    const total = results.reduce((sum, v) => sum + v, 0);
    const entry = {
        faces: state.diceSettings.faces,
        count: results.length,
        results,
        total,
        time: formatTime(new Date()),
    };
    state.diceHistory.unshift(entry);
    if (state.diceHistory.length > HISTORY_LIMIT) {
        state.diceHistory.length = HISTORY_LIMIT;
    }
    saveJSON(STORAGE_KEYS.diceHistory, state.diceHistory);
    renderHistory("dice");
}

function completeCoinToss(results) {
    showCoinResult(results);
    pushCoinHistory(results);
    state.isTossing = false;
    setTossingUI(false);
}

function showCoinResult(results) {
    const labelOf = (r) => (r === "heads" ? "表" : "裏");
    if (results.length === 1) {
        el.coinResultArea.innerHTML = `
            <div class="result-values"><span>${labelOf(results[0])}</span></div>
        `;
        return;
    }
    const heads = results.filter((r) => r === "heads").length;
    const tails = results.length - heads;
    const valuesHtml = results.map((r) => `<span>${labelOf(r)}</span>`).join("");
    el.coinResultArea.innerHTML = `
        <div class="result-values">${valuesHtml}</div>
        <div class="result-total">表：${heads} / 裏：${tails}</div>
    `;
}

function pushCoinHistory(results) {
    const heads = results.filter((r) => r === "heads").length;
    const tails = results.length - heads;
    const entry = {
        count: results.length,
        results,
        heads,
        tails,
        time: formatTime(new Date()),
    };
    state.coinHistory.unshift(entry);
    if (state.coinHistory.length > HISTORY_LIMIT) {
        state.coinHistory.length = HISTORY_LIMIT;
    }
    saveJSON(STORAGE_KEYS.coinHistory, state.coinHistory);
    renderHistory("coin");
}

function setRollingUI(isRolling) {
    el.rollBtn.disabled = isRolling;
    el.settingsBtn.disabled = isRolling || state.isTossing;
}

function setTossingUI(isTossing) {
    el.tossBtn.disabled = isTossing;
    el.settingsBtn.disabled = isTossing || state.isRolling;
}

function renderHistory(tab) {
    const list = tab === "dice" ? el.diceHistoryList : el.coinHistoryList;
    const data = tab === "dice" ? state.diceHistory : state.coinHistory;

    list.innerHTML = "";

    if (data.length === 0) {
        const li = document.createElement("li");
        li.className = "history-empty";
        li.textContent = "まだ履歴がありません";
        list.appendChild(li);
        return;
    }

    data.forEach((entry) => {
        list.appendChild(tab === "dice" ? renderDiceHistoryItem(entry) : renderCoinHistoryItem(entry));
    });
}

function renderDiceHistoryItem(entry) {
    const li = document.createElement("li");
    li.className = "history-item";
    const typeLabel = entry.faces === 100 ? "D100（2個固定）" : `D${entry.faces} × ${entry.count}`;
    const summaryLabel = entry.faces === 100 ? `結果 ${entry.total}` : `合計 ${entry.total}`;
    li.innerHTML = `
        <div class="history-item-main">
            <span class="history-item-type">${typeLabel}</span>
            <span class="history-item-values">${entry.results.join("・")}</span>
            <span class="history-item-summary">${summaryLabel}</span>
        </div>
        <span class="history-item-time">${entry.time}</span>
    `;
    return li;
}

function renderCoinHistoryItem(entry) {
    const li = document.createElement("li");
    li.className = "history-item";
    const labels = entry.results.map((r) => (r === "heads" ? "表" : "裏")).join("・");
    li.innerHTML = `
        <div class="history-item-main">
            <span class="history-item-type">COIN × ${entry.count}</span>
            <span class="history-item-values">${labels}</span>
            <span class="history-item-summary">表：${entry.heads} / 裏：${entry.tails}</span>
        </div>
        <span class="history-item-time">${entry.time}</span>
    `;
    return li;
}

function formatTime(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
}

function bindClearEvents() {
    document.querySelectorAll(".clear-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.clearTarget = btn.dataset.clear;
            el.confirmDialog.hidden = false;
        });
    });

    el.confirmCancelBtn.addEventListener("click", () => {
        state.clearTarget = null;
        el.confirmDialog.hidden = true;
    });

    el.confirmDeleteBtn.addEventListener("click", () => {
        if (state.clearTarget === "dice") {
            state.diceHistory = [];
            saveJSON(STORAGE_KEYS.diceHistory, state.diceHistory);
            renderHistory("dice");
        } else if (state.clearTarget === "coin") {
            state.coinHistory = [];
            saveJSON(STORAGE_KEYS.coinHistory, state.coinHistory);
            renderHistory("coin");
        }
        state.clearTarget = null;
        el.confirmDialog.hidden = true;
    });
}

function bindSettingsEvents() {
    el.settingsBtn.addEventListener("click", openSettingsModal);
    el.coinEmphasizeSides.addEventListener("change", () => {
        if (state.settingsTarget === "coin" && state.draft) {
            state.draft.emphasizeSides = el.coinEmphasizeSides.checked;
        }
    });

    el.settingsModal.querySelectorAll(".stepper-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetKey = btn.dataset.target; // 'diceCount' | 'coinCount'
            const dir = btn.dataset.step === "inc" ? 1 : -1;
            adjustDraftCount(targetKey, dir);
        });
    });

    el.diceTypeBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            if (state.settingsTarget !== "dice") return;
            const faces = Number(btn.dataset.faces);
            if (DICE_TYPES.includes(faces)) {
                state.draft.faces = faces;
                renderSettingsDraft();
            }
        });
    });

    el.settingsCancelBtn.addEventListener("click", closeSettingsModal);
    el.settingsConfirmBtn.addEventListener("click", confirmSettings);

    // オーバーレイの背景タップはキャンセル扱い（変更を破棄）
    el.settingsModal.addEventListener("click", (e) => {
        if (e.target === el.settingsModal) closeSettingsModal();
    });
}

function openSettingsModal() {
    const tab = getActiveTab();
    state.settingsTarget = tab;

    if (tab === "dice") {
        state.draft = { ...state.diceSettings };
        el.settingsBodyDice.hidden = false;
        el.settingsBodyCoin.hidden = true;
    } else {
        state.draft = { ...state.coinSettings };
        el.settingsBodyDice.hidden = true;
        el.settingsBodyCoin.hidden = false;
    }

    renderSettingsDraft();
    el.settingsModal.hidden = false;
}

function closeSettingsModal() {
    state.draft = null;
    el.settingsModal.hidden = true;
}

function adjustDraftCount(targetKey, dir) {
    if (targetKey === "diceCount") {
        if (state.draft.faces === 100) return;
        state.draft.count = clamp(state.draft.count + dir, 1, 3);
    } else if (targetKey === "coinCount") {
        state.draft.count = clamp(state.draft.count + dir, 1, 3);
    }
    renderSettingsDraft();
}

function renderSettingsDraft() {
    if (state.settingsTarget === "dice") {
        const isD100 = state.draft.faces === 100;
        el.diceCountValue.textContent = isD100 ? "2個固定" : String(state.draft.count);
        el.diceCountRow.classList.toggle("is-fixed", isD100);
        el.diceCountRow.querySelectorAll('.stepper-btn[data-target="diceCount"]').forEach((btn) => {
            btn.disabled = isD100;
        });
        el.diceTypeBtns.forEach((btn) => {
            const isSelected = Number(btn.dataset.faces) === state.draft.faces;
            btn.classList.toggle("is-selected", isSelected);
            btn.setAttribute("aria-pressed", String(isSelected));
        });
    } else {
        el.coinCountValue.textContent = String(state.draft.count);
        el.coinEmphasizeSides.checked = Boolean(state.draft.emphasizeSides);
    }
}

function confirmSettings() {
    if (state.settingsTarget === "dice") {
        state.diceSettings = normalizeDiceSettings(state.draft);
        saveJSON(STORAGE_KEYS.diceSettings, state.diceSettings);
        renderDiceStage();
    } else if (state.settingsTarget === "coin") {
        const countChanged = state.coinSettings.count !== state.draft.count;
        state.coinSettings = { ...state.draft };
        saveJSON(STORAGE_KEYS.coinSettings, state.coinSettings);
        if (countChanged) renderCoinStage();
        else updateCoinEmphasis();
    }
    closeSettingsModal();
}

// All app elements precede this async module. Advertising and DOMContentLoaded are not prerequisites.
init();

