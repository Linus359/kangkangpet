'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const petHtml = fs.readFileSync(path.join(__dirname, '..', 'pet.html'), 'utf8');

test('pet interaction animations stay on the inner motion layer', () => {
  const bounce = petHtml.match(/@keyframes bounce\s*\{([\s\S]*?)\n    \}/)?.[1] || '';
  const wiggle = petHtml.match(/@keyframes wiggle\s*\{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(petHtml, /<section id="petWrap"[\s\S]*?<div id="petMotion">/);
  assert.match(petHtml, /const petMotion = document\.querySelector\('#petMotion'\);/);
  assert.match(petHtml, /petMotion\.classList\.remove\('bounce', 'wiggle'\)/);
  assert.equal(bounce.includes('translateX(-50%)'), false);
  assert.equal(wiggle.includes('translateX(-50%)'), false);
  assert.match(petHtml, /#petWrap \{[\s\S]*?transform: translateX\(-50%\);[\s\S]*?\}/);
  assert.doesNotMatch(petHtml.match(/#petWrap \{([\s\S]*?)\}/)?.[1] || '', /transition:\s*transform/);
});

test('renderer sends the displayed asset with each window layout update', () => {
  assert.match(petHtml, /desktopPetApi\.updateLayout\(\{ assetId: layout\.assetId, bubble: layout\.bubble, menu: layout\.menu \}\)/);
  assert.match(petHtml, /function isInteractionActive\(\) \{/);
  assert.match(petHtml, /if \(isInteractionActive\(\)\) \{/);
  assert.match(petHtml, /function flushPendingLayout\(\)/);
});

test('interaction defers layout changes and idle actions until the pointer leaves', () => {
  assert.match(petHtml, /if \(isInteractionActive\(\)\) \{\s*scheduleIdle\(randomBetween\(1200, 2200\)\);\s*return;/);
  assert.match(petHtml, /window\.addEventListener\('mouseleave',[\s\S]*?flushPendingLayout\(\);/);
  assert.match(petHtml, /window\.addEventListener\('blur',[\s\S]*?flushPendingLayout\(\);/);
});

test('interaction controls avoid native title tooltips that close hover menus', () => {
  assert.doesNotMatch(petHtml, /(?:trigger|item|settingsButton)\.title\s*=/);
  assert.match(petHtml, /trigger\.setAttribute\('aria-label', label\);/);
  assert.match(petHtml, /settingsButton\.setAttribute\('aria-label', '设置'\);/);
});

test('hover menus verify the pointer position before closing', () => {
  assert.match(petHtml, /let lastPointerPosition = null;/);
  assert.match(petHtml, /function menuGroupContainsPointer\(group\) \{/);
  assert.match(petHtml, /lastPointerPosition = \{ x: event\.clientX, y: event\.clientY \};/);
  assert.match(petHtml, /if \(!menuGroupContainsPointer\(group\)\) setOpen\(false\);/);
  assert.match(petHtml, /window\.addEventListener\('mouseleave',[\s\S]*?lastPointerPosition = null;[\s\S]*?closeInteractionMenus\(\);/);
  assert.match(petHtml, /window\.addEventListener\('blur',[\s\S]*?lastPointerPosition = null;[\s\S]*?closeInteractionMenus\(\);/);
});

test('bubble layout remeasures after the window width changes', () => {
  assert.match(petHtml, /function currentBubbleLayout\(\) \{/);
  assert.match(petHtml, /box-sizing: border-box;/);
  assert.match(petHtml, /width: Math\.min\(240, Math\.max\(140, Math\.round\(rect\.width\)\)\)/);
  assert.match(petHtml, /height: Math\.max\(40, Math\.ceil\(rect\.height\)\)/);
  assert.match(petHtml, /function scheduleBubbleLayoutUpdate\(\) \{/);
  assert.match(petHtml, /window\.addEventListener\('resize', \(\) => \{[\s\S]*?scheduleBubbleLayoutUpdate\(\);/);
  assert.match(petHtml, /max-height: 300px;/);
  assert.match(petHtml, /overflow-y: auto;/);
  assert.match(petHtml, /#bubble\.show \{[\s\S]*?pointer-events: auto;/);
});

test('bubble reserves layout before showing and releases it after fading out', () => {
  assert.match(petHtml, /function showMessage\([\s\S]*?updateWindowLayout\(true, true\);/);
  assert.match(petHtml, /bubbleRevealFrame = requestAnimationFrame\([\s\S]*?updateWindowLayout\(true, true\);[\s\S]*?bubble\.classList\.add\('show'\);/);
  assert.match(petHtml, /function startBubbleDismissTimer\([\s\S]*?bubble\.classList\.remove\('show'\);[\s\S]*?setTimeout\([\s\S]*?updateWindowLayout\(false\);/);
  assert.match(petHtml, /const BUBBLE_TRANSITION_MS = 240;/);
  assert.match(petHtml, /let bubbleLayoutReserved = false;/);
  assert.match(petHtml, /bubbleLayoutReserved = true;/);
  assert.match(petHtml, /bubbleLayoutReserved = false;/);
  assert.match(petHtml, /function updateWindowLayout\(bubbleVisible = bubbleLayoutReserved, force = false\)/);
  assert.match(petHtml, /if \(isInteractionActive\(\) && !force\) \{/);
  assert.match(petHtml, /if \(force\) pendingLayout = null;/);
});

test('bubble is anchored above the pet instead of the window top', () => {
  const bubbleStyle = petHtml.match(/#bubble \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(bubbleStyle, /bottom: calc\(var\(--controls-height\) \+ var\(--pet-size\) \+ 6px\);/);
  assert.doesNotMatch(bubbleStyle, /top:/);
});

test('opened interaction menus retain their original vertical position and reserve horizontal space', () => {
  assert.match(petHtml, /function currentMenuLayout\(\) \{/);
  assert.match(petHtml, /function scheduleMenuLayoutUpdate\(\) \{/);
  assert.match(petHtml, /bottom: 32px;/);
  assert.match(petHtml, /reserveVertical: false/);
  assert.match(petHtml, /updateWindowLayout\(bubbleLayoutReserved, true\);/);
  assert.match(petHtml, /scheduleMenuLayoutUpdate\(\);/);
});

test('work mode turns pet interactions into handbook tip controls by default', () => {
  const buttonsStyle = petHtml.match(/#buttons \{([^}]*)\}/)?.[1] || '';
  assert.match(buttonsStyle, /opacity: 0;/);
  assert.match(buttonsStyle, /visibility: hidden;/);
  assert.match(buttonsStyle, /transition: opacity 180ms ease, visibility 0s linear 180ms;/);
  assert.match(buttonsStyle, /left: 50%;/);
  assert.match(buttonsStyle, /flex-direction: row;/);
  assert.match(buttonsStyle, /flex-wrap: nowrap;/);
  assert.match(buttonsStyle, /transform: translateX\(-50%\);/);
  assert.match(buttonsStyle, /bottom: var\(--controls-bottom\);/);
  assert.match(petHtml, /function renderInteractionMenus\(\)/);
  assert.match(petHtml, /let interactionMenuSignature = '';/);
  assert.match(petHtml, /if \(nextMenuSignature !== interactionMenuSignature\) \{[\s\S]*?renderInteractionMenus\(\);/);
  assert.match(petHtml, /const workModeEnabled = config\?\.workModeEnabled !== false;/);
  assert.match(petHtml, /createMenuGroup\(workModeEnabled \? '💡' : '🧸', workModeEnabled \? '员工守则小贴士' : '陪康康玩'\)/);
  assert.match(petHtml, /createMenuGroup\('💼', '工作模式'\)/);
  assert.match(petHtml, /'随机来一条小贴士'/);
  assert.doesNotMatch(petHtml, /'今日员工守则'/);
  assert.match(petHtml, /'继续阅读上一条'/);
  assert.match(petHtml, /config\?\.workModeEnabled !== false \? '休息一下' : '开始工作'/);
  assert.match(petHtml, /await desktopPetApi\.showHandbookTip\(\{ interactive: true \}\)/);
  assert.match(petHtml, /suppressIdleMessage: true/);
  assert.match(petHtml, /interactionButtons\.filter\(\(item\) => item\.id !== 'work'\)/);
  assert.match(petHtml, /await desktopPetApi\.toggleWorkMode\(\)/);
  assert.match(petHtml, /'快速新建提醒'/);
  assert.match(petHtml, /'打开提醒管理'/);
  assert.match(petHtml, /settings-button/);
  assert.match(petHtml, /interaction-submenu/);
  assert.match(petHtml, /\.interaction-submenu \{[\s\S]*?background: #fff;/);
  assert.match(petHtml, /\.interaction-menu-item > span\[aria-hidden="true"\] \{[\s\S]*?flex: 0 0 16px;[\s\S]*?font-family: "Segoe UI Emoji", "Segoe UI Symbol", sans-serif;/);
  assert.match(petHtml, /group\.addEventListener\('mouseenter', \(\) => setOpen\(true\)\)/);
  assert.match(petHtml, /const scheduleClose = \(\) => \{/);
  assert.match(petHtml, /setTimeout\(\(\) => \{\s*if \(!menuGroupContainsPointer\(group\)\) setOpen\(false\);\s*\}, 180\)/);
  assert.match(petHtml, /menu\.addEventListener\('mouseenter', \(\) => clearTimeout\(closeTimer\)\)/);
  assert.match(petHtml, /const openGroup = openSubmenu\?\.closest\('\.interaction-group'\);/);
  assert.match(petHtml, /#petWrap \{[\s\S]*?left: 50%;[\s\S]*?bottom: var\(--controls-height\);/);
  assert.match(petHtml, /#bubble \{[\s\S]*?left: 50%;/);
  assert.match(petHtml, /#bubble \{[\s\S]*?translateY\(4px\);/);
  const bubbleStyle = petHtml.match(/#bubble \{([^}]*)\}/)?.[1] || '';
  const bubbleShowStyle = petHtml.match(/#bubble\.show \{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(bubbleStyle, /scale\(/);
  assert.doesNotMatch(bubbleShowStyle, /scale\(/);
  assert.match(petHtml, /transition: opacity 200ms ease-out, transform 220ms cubic-bezier\(\.22, 1, \.36, 1\);/);
  assert.match(petHtml, /interactionButtonPresentation\(item\)/);
  assert.match(petHtml, /icon: '🤚'/);
  assert.match(petHtml, /icon: '💬'/);
  assert.match(petHtml, /icon: '🍎'/);
  assert.match(petHtml, /icon: '💼'/);
});

test('low-resource mode reduces idle work and pauses media while the system is inactive', () => {
  assert.match(petHtml, /config\?\.petLowResourceMode !== false \? 1 : 4/);
  assert.match(petHtml, /randomBetween\(14000, 30000\)/);
  assert.match(petHtml, /preferStill: !options\.interaction && \(config\?\.petLowResourceMode !== false \|\| isRestAction\(actionKey\)\)/);
  assert.match(petHtml, /desktopPetApi\.onPerformanceSuspend/);
  assert.match(petHtml, /if \(!petVisible \|\| performanceSuspended \|\| config\?\.doNotDisturbMode\) return;/);
});

test('do-not-disturb mode suppresses pet chatter, idle actions and interaction controls but preserves reminders', () => {
  assert.match(petHtml, /if \(config\?\.doNotDisturbMode && !isReminder\) return;/);
  assert.match(petHtml, /buttons\.hidden = config\?\.doNotDisturbMode === true;/);
  assert.match(petHtml, /if \(config\?\.doNotDisturbMode\) return;/);
  assert.match(petHtml, /showMessage\(text, window\.currentStrongReminder \? 0 : 9000, true\)/);
  assert.doesNotMatch(petHtml, /playTapFeedback|tapFeedbackEnabled/);
});

test('double-click remains a functional FORCOME AI entry during do-not-disturb mode', () => {
  const handler = petHtml.match(/stage\.addEventListener\('dblclick',[\s\S]*?\n    \}\);/)?.[0] || '';
  const opener = petHtml.match(/async function openPwaFromPet\(\)[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(handler, /openPwaFromPet\(\)/);
  assert.match(opener, /desktopPetApi\.openPwa\(\)/);
  assert.doesNotMatch(handler, /doNotDisturbMode/);
  assert.match(petHtml, /const PET_DOUBLE_CLICK_WINDOW_MS = 600;/);
  assert.match(petHtml, /event\.detail >= 2/);
  assert.match(petHtml, /function openPwaFromPet\(\)/);
  assert.match(petHtml, /clearTimeout\(singleClickTimer\);/);
});

test('manual and body handbook tips interrupt the current bubble', () => {
  const manualTip = petHtml.match(/async function showHandbookTip\(\) \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(manualTip, /desktopPetApi\.showHandbookTip\(\{ interactive: true \}\)/);
  const replayTip = petHtml.match(/async function replayHandbookTip\(\) \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.doesNotMatch(replayTip, /beginWorkModeDifyRequest|settleWorkModeDifyRequest/);
  assert.match(replayTip, /await desktopPetApi\.replayHandbookTip\(\)/);
  const bodyInteraction = petHtml.match(/async function interact\(source\)[\s\S]*?\n    \}/)?.[0] || '';
  assert.doesNotMatch(bodyInteraction, /beginWorkModeDifyRequest|showPolicyTip|settleWorkModeDifyRequest/);
  assert.match(bodyInteraction, /await desktopPetApi\.showHandbookTip\(\{ interactive: true \}\)/);
  assert.match(petHtml, /function showInteractiveReminderImmediately\(reminder\)/);
  assert.match(petHtml, /if \(reminder\.employeePolicyInteractive === true\) showInteractiveReminderImmediately\(reminder\)/);
});
