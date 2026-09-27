<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AdminService, type ModerationAuditEntry, type ModerationReview } from '../../services/admin'
import { searchKey } from '../../search'
import StarRating from '../StarRating.vue'

const props = defineProps<{ service: AdminService }>()
const emit = defineEmits<{ toast: [string] }>()

const reviews = ref<ModerationReview[]>([])
const loading = ref(true)
const error = ref('')
const stateFilter = ref<'all' | ModerationReview['moderation_state']>('all')
const search = ref('')
const pendingAction = ref<{ id: string; state: ModerationReview['moderation_state'] } | null>(null)
const reason = ref('')
const saving = ref(false)
const auditId = ref<string | null>(null)
const audit = ref<ModerationAuditEntry[]>([])

async function load() {
  loading.value = true
  error.value = ''
  try { reviews.value = await props.service.listModerationReviews(stateFilter.value === 'all' ? undefined : stateFilter.value) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดรีวิวสำหรับตรวจสอบได้' }
  finally { loading.value = false }
}

watch(stateFilter, () => { pendingAction.value = null; void load() })
onMounted(load)

const visibleReviews = computed(() => {
  const query = searchKey(search.value)
  return !query ? reviews.value : reviews.value.filter((review) => [review.text, review.course_code ?? '', review.course_name ?? ''].some((field) => searchKey(field).includes(query)))
})
const states = [{ key: 'all', label: 'ทั้งหมด' }, { key: 'visible', label: 'เผยแพร่' }, { key: 'hidden', label: 'ซ่อน' }, { key: 'removed', label: 'นำออก' }] as const
const thaiDate = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
const expanded = ref<Record<string, boolean>>({})
const overflowing = ref<Record<string, boolean>>({})
const list = ref<HTMLElement | null>(null)
function measureText() {
  const measured: Record<string, boolean> = {}
  list.value?.querySelectorAll<HTMLElement>('.admin-review-text').forEach((element) => {
    const wasExpanded = element.classList.contains('is-expanded')
    element.classList.remove('is-expanded')
    measured[element.dataset.reviewId!] = element.scrollHeight > element.clientHeight
    if (wasExpanded) element.classList.add('is-expanded')
  })
  overflowing.value = measured
}
watch(visibleReviews, () => nextTick(measureText), { flush: 'post' })
let observer: ResizeObserver | undefined
onActivated(() => {
  nextTick(measureText)
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measureText)
    if (list.value) observer.observe(list.value)
  }
  window.addEventListener('resize', measureText)
})
function stopMeasuring() { observer?.disconnect(); window.removeEventListener('resize', measureText) }
onDeactivated(stopMeasuring)
onBeforeUnmount(stopMeasuring)
function chooseAction(id: string, state: ModerationReview['moderation_state']) {
  pendingAction.value = { id, state }
  reason.value = ''
  nextTick(() => document.getElementById('admin-review-reason')?.focus())
}

function stateLabel(state: ModerationReview['moderation_state']) { return state === 'visible' ? 'เผยแพร่' : state === 'hidden' ? 'ซ่อน' : 'นำออก' }
function stateBadgeClass(state: ModerationReview['moderation_state']) { return `admin-state-badge admin-state-${state}` }

async function toggleAudit(reviewId: string) {
  if (auditId.value === reviewId) { auditId.value = null; return }
  try { audit.value = await props.service.listModerationAudit(reviewId); auditId.value = reviewId }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดประวัติการตรวจสอบได้' }
}

async function moderate() {
  if (!pendingAction.value || !reason.value.trim() || saving.value) return
  const { id, state } = pendingAction.value
  saving.value = true
  try {
    await props.service.moderateReview(id, state, reason.value)
    pendingAction.value = null
    reason.value = ''
    await load()
    if (auditId.value === id) audit.value = await props.service.listModerationAudit(id)
    emit('toast', 'เปลี่ยนสถานะรีวิวสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเปลี่ยนสถานะรีวิวได้' }
  finally { saving.value = false }
}
</script>

<template>
  <div ref="list" class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">รีวิว</h2>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <div class="row g-2 mb-3">
      <div class="col-md-5">
        <label class="section-label-sm" for="admin-review-search">ค้นหาข้อความรีวิว</label>
        <input id="admin-review-search" v-model="search" class="form-control" placeholder="ค้นหาข้อความรีวิว" />
      </div>
      <div class="col-md-5 d-flex align-items-end">
        <div class="admin-review-chips" aria-label="สถานะรีวิว"><button v-for="state in states" :key="state.key" class="category-btn" :class="{ active: stateFilter === state.key }" :aria-pressed="stateFilter === state.key" @click="stateFilter = state.key">{{ state.label }}</button></div>
      </div>
      <div class="col-md-2 d-flex align-items-end">
        <button class="btn btn-outline-purple w-100" @click="load">โหลดใหม่</button>
      </div>
    </div>
    <p v-if="loading" class="text-muted">กำลังโหลดข้อมูล...</p>
    <template v-else>
      <div v-if="!visibleReviews.length && !error" class="admin-empty"><p>ไม่พบรีวิว</p><button v-if="stateFilter !== 'all'" class="btn btn-outline-purple" @click="stateFilter = 'all'">ทุกสถานะ</button></div>
      <article v-for="review in visibleReviews" :key="review.id" class="admin-review-row">
        <div class="d-flex justify-content-between gap-2">
          <StarRating class="stars" :value="review.rating" :label="`ให้คะแนน ${review.rating} จาก 5 ดาว`" />
          <small>
            <span :class="stateBadgeClass(review.moderation_state)">{{ stateLabel(review.moderation_state) }}</span>
            <span v-if="!review.author_active"> · ผู้เขียนถอนการเผยแพร่</span>
          </small>
        </div>
        <div class="admin-review-meta">
          <span v-if="review.course_code && review.course_name" class="admin-review-course"><strong>{{ review.course_code }}</strong> · {{ review.course_name }}</span>
          <time :datetime="review.created_at">{{ thaiDate.format(new Date(review.created_at)) }}</time>
        </div>
        <p class="admin-review-text" :class="{ 'is-expanded': expanded[review.id] }" :data-review-id="review.id" :id="`review-text-${review.id}`">{{ review.text }}</p>
        <button v-if="overflowing[review.id]" class="btn btn-link admin-text-toggle" :aria-expanded="!!expanded[review.id]" :aria-controls="`review-text-${review.id}`" @click="expanded[review.id] = !expanded[review.id]">{{ expanded[review.id] ? 'ย่อ' : 'อ่านต่อ' }}</button>
        <div class="d-flex flex-wrap gap-2">
          <button v-if="review.moderation_state !== 'visible'" class="btn btn-sm btn-outline-purple" :disabled="saving" @click="chooseAction(review.id, 'visible')">คืนสถานะ</button>
          <button v-if="review.moderation_state !== 'hidden'" class="btn btn-sm btn-outline-secondary" :disabled="saving" @click="chooseAction(review.id, 'hidden')">ซ่อน</button>
          <button v-if="review.moderation_state !== 'removed'" class="btn btn-sm btn-outline-danger" :disabled="saving" @click="chooseAction(review.id, 'removed')">นำออก</button>
          <button class="btn btn-sm btn-link admin-history-toggle" :aria-expanded="auditId === review.id" @click="toggleAudit(review.id)"><i class="bi bi-clock-history me-1" aria-hidden="true"></i>{{ auditId === review.id ? 'ซ่อนประวัติ' : 'ประวัติ' }}</button>
        </div>
        <form v-if="pendingAction?.id === review.id" class="admin-reason-panel" @submit.prevent="moderate">
          <h3 class="h6">เปลี่ยนสถานะเป็น {{ stateLabel(pendingAction.state) }}</h3>
          <label for="admin-review-reason">เหตุผล (จำเป็น)</label>
          <textarea id="admin-review-reason" v-model="reason" required class="form-control mb-2" :aria-label="`เหตุผลสำหรับรีวิว ${review.id}`"></textarea>
          <div class="d-flex gap-2 justify-content-end">
            <button type="button" class="btn btn-outline-secondary" :disabled="saving" @click="pendingAction = null">ยกเลิก</button>
            <button type="submit" class="btn btn-purple" :disabled="!reason.trim() || saving">ยืนยัน</button>
          </div>
        </form>
        <div v-if="auditId === review.id" class="mt-3 border-top pt-3">
          <p v-if="!audit.length" class="text-muted mb-0">ยังไม่เคยมีการเปลี่ยนสถานะ</p>
          <div v-for="entry in audit" :key="entry.id" class="mb-2">
            <small class="text-muted d-block">{{ entry.createdAt }} · {{ entry.actorName }}</small>
            <span>{{ stateLabel(entry.priorState) }} → {{ stateLabel(entry.newState) }}</span>
            <p class="mb-0 text-break">{{ entry.reason }}</p>
          </div>
        </div>
      </article>
    </template>
  </div>
</template>
