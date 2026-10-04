<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { chromeRecoveryLink, embeddedBrowser, recoveryLink } from '../services/auth-recovery'

defineProps<{ failed: boolean }>()
const browser = embeddedBrowser(navigator.userAgent)
const isIOS = /iPhone|iPad|iPod|Macintosh.*Mobile/i.test(navigator.userAgent)
const isAndroid = /Android/i.test(navigator.userAgent)
const link = recoveryLink(window.location.origin)
const primaryLink = browser === 'LINE' ? recoveryLink(window.location.origin, true, true)
  : browser && isAndroid ? chromeRecoveryLink(window.location.origin, true) : null
const primaryLabel = browser === 'LINE' ? 'เปิดในเบราว์เซอร์เพื่อเข้าสู่ระบบ' : 'เปิด Chrome เพื่อเข้าสู่ระบบ'
const showMenu = ref(!primaryLink)
const menuApp = browser ?? 'แอปที่เปิดเว็บไซต์'
const copyState = ref<'idle' | 'copied' | 'manual'>('idle')
const summary = ref<HTMLElement | null>(null)
const details = ref<HTMLDetailsElement | null>(null)
const guidanceRequested = ref(false)

async function requestExternalBrowser() {
  guidanceRequested.value = true
  await nextTick()
  // A user may have closed the native disclosure while Vue's bound value
  // remained true. Explicitly reopen it when the Google button requests help.
  if (details.value) details.value.open = true
  summary.value?.focus()
}
defineExpose({ requestExternalBrowser })

async function copyLink() {
  try {
    await navigator.clipboard.writeText(link)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'manual'
  }
}
</script>

<template>
  <details ref="details" class="login-browser-help" :open="Boolean(browser) || failed || guidanceRequested">
    <summary ref="summary" class="browser-help-heading">
      <i class="bi bi-box-arrow-up-right browser-heading-icon" aria-hidden="true"></i>
      <span>{{ browser ? `เข้าสู่ระบบจาก ${browser}` : 'เปิดเว็บจากแอป?' }}</span>
      <i class="bi bi-chevron-down browser-disclosure-icon" aria-hidden="true"></i>
    </summary>
    <div class="browser-help-body">
      <p v-if="guidanceRequested" class="browser-required-status" role="status">กรุณาเปิดเว็บไซต์ใน Safari หรือ Chrome ก่อนเข้าสู่ระบบด้วย Google</p>
      <p class="browser-help-intro">ใช้ Safari หรือ Chrome<br />เพื่อเข้าสู่ระบบด้วย Google</p>
      <a v-if="primaryLink" class="btn btn-purple browser-primary-action" :href="primaryLink" @click="showMenu = true">{{ primaryLabel }} <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>
      <ol v-if="showMenu" class="browser-menu-steps" role="list">
        <li><span class="browser-step-number" aria-hidden="true">1</span><span class="browser-step-content"><strong>แตะเมนู <span class="browser-menu-icon" aria-label="สามจุด">⋯</span></strong><small>บนแถบของ {{ menuApp }}</small></span></li>
        <li><span class="browser-step-number" aria-hidden="true">2</span><span class="browser-step-content"><strong>เลือก “เปิดในเบราว์เซอร์”</strong><small>Open in browser / Open in Safari</small></span></li>
      </ol>
      <p v-if="showMenu" class="browser-next-step"><i class="bi bi-arrow-return-right" aria-hidden="true"></i> แล้วแตะ “เข้าสู่ระบบด้วย Google”</p>
      <details class="browser-alternatives">
        <summary><span>{{ primaryLink ? 'ปุ่มไม่เปิด? ลองวิธีอื่น' : 'ไม่พบเมนูนี้?' }}</span><i class="bi bi-chevron-down browser-disclosure-icon" aria-hidden="true"></i></summary>
        <ol v-if="!showMenu" class="browser-menu-steps" role="list">
          <li><span class="browser-step-number" aria-hidden="true">1</span><span class="browser-step-content"><strong>แตะเมนู <span class="browser-menu-icon" aria-label="สามจุด">⋯</span></strong><small>บนแถบของ {{ menuApp }}</small></span></li>
          <li><span class="browser-step-number" aria-hidden="true">2</span><span class="browser-step-content"><strong>เลือก “เปิดในเบราว์เซอร์”</strong><small>Open in browser / Open in Safari</small></span></li>
        </ol>
        <p>หากไม่มีตัวเลือกนี้ ให้คัดลอกลิงก์ไปวางใน {{ isIOS ? 'Safari หรือ Chrome' : 'เบราว์เซอร์ของโทรศัพท์' }}</p>
        <button type="button" class="btn btn-outline-purple browser-copy-button" @click="copyLink"><i :class="copyState === 'copied' ? 'bi bi-check2' : 'bi bi-copy'" aria-hidden="true"></i> คัดลอกลิงก์เว็บไซต์</button>
        <p class="browser-copy-status" role="status" aria-live="polite">
          {{ copyState === 'copied' ? `คัดลอกแล้ว วางลิงก์ใน ${isIOS ? 'Safari หรือ Chrome' : 'Chrome หรือเบราว์เซอร์ของโทรศัพท์'}` : copyState === 'manual' ? 'คัดลอกอัตโนมัติไม่ได้ แตะช่องลิงก์ด้านล่างแล้วคัดลอกเอง' : '' }}
        </p>
        <label v-if="copyState === 'manual'" class="browser-manual-link">
          ลิงก์เว็บไซต์
          <input class="form-control" readonly :value="link" @focus="($event.target as HTMLInputElement).select()" />
        </label>
      </details>
    </div>
  </details>
</template>

<style scoped>
/* Brand-preserving sign-in guidance: 14px controls, 20px enclosing surface. */
.login-browser-help { margin: 1rem 0; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--purple-50); color: var(--purple-900); text-align: left; }
summary { display: flex; align-items: center; gap: 12px; padding: 16px; cursor: pointer; min-height: 48px; list-style: none; }
summary::-webkit-details-marker { display: none; }
.browser-help-heading { font-family: 'Kanit', sans-serif; font-size: 1.12rem; font-weight: 500; line-height: 1.4; }
.browser-help-heading > span { flex: 1; min-width: 0; }
.browser-heading-icon { display: grid; place-items: center; flex: 0 0 36px; width: 36px; height: 36px; border-radius: 10px; background: var(--purple-100); color: var(--purple-700); font-size: 1rem; }
.browser-disclosure-icon { margin-left: auto; color: var(--ink-600); font-size: .75rem; }
.login-browser-help[open] > summary > .browser-disclosure-icon, .browser-alternatives[open] > summary > .browser-disclosure-icon { transform: rotate(180deg); }
.browser-help-body { padding: 0 20px 4px; font-size: .95rem; font-weight: 400; line-height: 1.65; }
.browser-help-body p { margin-bottom: 16px; }
.browser-help-intro { color: var(--ink-600); }
.browser-required-status { font-weight: 600; }
.browser-primary-action { display: flex; justify-content: center; align-items: center; width: 100%; min-height: 48px; gap: 10px; padding: 12px; font-size: .9rem; line-height: 1.5; }
.browser-primary-action > i { flex-shrink: 0; }
.browser-primary-action:active { background: var(--purple-700); color: var(--white); }
.browser-menu-steps { display: grid; gap: 20px; padding: 0; margin: 20px 0; list-style: none; }
.browser-menu-steps li { display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: start; gap: 12px; }
.browser-step-number { display: grid; place-items: center; height: 28px; border-radius: 50%; background: var(--purple-100); color: var(--purple-700); font-size: .85rem; font-weight: 600; }
.browser-step-content strong { display: flex; align-items: center; gap: 8px; font-weight: 500; line-height: 1.65; }
.browser-menu-steps small { display: block; margin-top: 4px; color: var(--ink-600); font-size: .78rem; line-height: 1.6; }
.browser-menu-icon { display: inline-grid; place-items: center; min-width: 32px; height: 26px; border: 1px solid var(--purple-300); border-radius: 6px; background: var(--white); font-size: 1.3rem; line-height: 1; }
.browser-help-body .browser-next-step { display: flex; align-items: baseline; gap: 8px; margin-bottom: 20px; font-size: .8rem; color: var(--ink-600); }
.browser-next-step > i { color: var(--purple-700); }
.browser-alternatives { border-top: 1px solid var(--line); }
.browser-alternatives summary { justify-content: space-between; padding: 12px 0; font-size: .85rem; font-weight: 400; color: var(--ink-600); }
.browser-alternatives p { font-size: .9rem; }
.browser-copy-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 14px; font-size: .85rem; }
.browser-copy-button:active { background: var(--purple-700); color: var(--white); border-color: var(--purple-700); }
summary:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid var(--purple-700); outline-offset: 3px; }
summary:hover { color: var(--purple-700); }
.browser-primary-action:active, .browser-copy-button:active { transform: translateY(1px); }
.browser-copy-status:empty { display: none; }
.browser-help-body .browser-copy-status { margin: 12px 0 16px; color: var(--purple-900); }
.browser-manual-link { display: block; margin: 16px 0; }
.browser-manual-link input { margin-top: 6px; border-color: var(--ink-600); background: var(--white); color: var(--purple-900); font-size: 1rem; }
@media (max-width: 575px) {
  .browser-help-heading { font-size: 1rem; }
  .browser-help-body { padding-inline: 16px; }
}
</style>
