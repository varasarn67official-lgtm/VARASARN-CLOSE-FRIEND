<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { AdminService, type ModerationAuditEntry, type ModerationReview } from '../../services/admin'
import StarRating from '../StarRating.vue'

const props = defineProps<{ service: AdminService }>()
const emit = defineEmits<{ toast: [string] }>()

const reviews = ref<ModerationReview[]>([])
const loading = ref(true)
const error = ref('')
const stateFilter = ref<'all' | ModerationReview['moderation_state']>('all')
const search = ref('')
const reasons = ref<Record<string, string>>({})
const auditId = ref<string | null>(null)
const audit = ref<ModerationAuditEntry[]>([])

async function load() {
  loading.value = true
  try { reviews.value = await props.service.listModerationReviews(stateFilter.value === 'all' ? undefined : stateFilter.value) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดรีวิวสำหรับตรวจสอบได้' }
  finally { loading.value = false }
}

watch(stateFilter, load)
onMounted(load)

const visibleReviews = computed(() => {
  const query = search.value.trim().toLowerCase()
  return !query ? reviews.value : reviews.value.filter((review) => review.text.toLowerCase().includes(query))
})

function stateLabel(state: ModerationReview['moderation_state']) { return state === 'visible' ? 'เผยแพร่' : state === 'hidden' ? 'ซ่อน' : 'นำออก' }
function stateBadgeClass(state: ModerationReview['moderation_state']) { return `admin-state-badge admin-state-${state}` }

async function toggleAudit(reviewId: string) {
  if (auditId.value === reviewId) { auditId.value = null; return }
  try { audit.value = await props.service.listModerationAudit(reviewId); auditId.value = reviewId }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดประวัติการตรวจสอบได้' }
}

async function moderate(id: string, state: ModerationReview['moderation_state']) {
  try {
    await props.service.moderateReview(id, state, reasons.value[id] ?? '')
    reasons.value[id] = ''
    await load()
    if (auditId.value === id) audit.value = await props.service.listModerationAudit(id)
    emit('toast', 'เปลี่ยนสถานะรีวิวสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเปลี่ยนสถานะรีวิวได้' }
}
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">รีวิว</h2>
    <p class="admin-section-desc">กรองรีวิว เปลี่ยนสถานะพร้อมเหตุผล และดูประวัติการตรวจสอบ</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <div class="row g-2 mb-3">
      <div class="col-md-5">
        <label class="section-label-sm" for="admin-review-search">ค้นหาข้อความรีวิว</label>
        <input id="admin-review-search" v-model="search" class="form-control" placeholder="ค้นหาข้อความรีวิว" />
      </div>
      <div class="col-md-4">
        <label class="section-label-sm" for="admin-review-state">สถานะรีวิว</label>
        <select id="admin-review-state" v-model="stateFilter" class="form-select">
          <option value="all">ทุกสถานะ</option>
          <option value="visible">เผยแพร่</option>
          <option value="hidden">ซ่อน</option>
          <option value="removed">นำออก</option>
        </select>
      </div>
      <div class="col-md-3 d-flex align-items-end">
        <button class="btn btn-outline-purple w-100" @click="load">โหลดใหม่</button>
      </div>
    </div>
    <p v-if="loading" class="text-muted">กำลังโหลดข้อมูล...</p>
    <template v-else>
      <p v-if="!visibleReviews.length" class="text-muted">ไม่พบรีวิว</p>
      <article v-for="review in visibleReviews" :key="review.id" class="review-box">
        <div class="d-flex justify-content-between gap-2">
          <StarRating class="stars" :value="review.rating" :label="`ให้คะแนน ${review.rating} จาก 5 ดาว`" />
          <small>
            <span :class="stateBadgeClass(review.moderation_state)">{{ stateLabel(review.moderation_state) }}</span>
            <span v-if="!review.author_active"> · ผู้เขียนถอนการเผยแพร่</span>
          </small>
        </div>
        <p class="mb-2">{{ review.text }}</p>
        <input v-model="reasons[review.id]" class="form-control mb-2" placeholder="เหตุผลสำหรับการเปลี่ยนสถานะ" :aria-label="`เหตุผลสำหรับรีวิว ${review.id}`" />
        <div class="d-flex flex-wrap gap-2">
          <button v-if="review.moderation_state !== 'visible'" class="btn btn-sm btn-outline-purple" @click="moderate(review.id, 'visible')">คืนสถานะ</button>
          <button v-if="review.moderation_state !== 'hidden'" class="btn btn-sm btn-outline-danger" @click="moderate(review.id, 'hidden')">ซ่อน</button>
          <button v-if="review.moderation_state !== 'removed'" class="btn btn-sm btn-outline-danger" @click="moderate(review.id, 'removed')">นำออก</button>
          <button class="btn btn-sm btn-outline-secondary" @click="toggleAudit(review.id)">
            <i class="bi bi-clock-history me-1"></i>{{ auditId === review.id ? 'ซ่อนประวัติ' : 'ประวัติการตรวจสอบ' }}
          </button>
        </div>
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
