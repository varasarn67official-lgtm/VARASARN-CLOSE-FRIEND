<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { RpcClient } from '../../services/reviews'
import { AdminService, type Category, type ManagedCourse } from '../../services/admin'
import AdminCourses from './AdminCourses.vue'
import AdminCategories from './AdminCategories.vue'
import AdminMerge from './AdminMerge.vue'
import AdminPeriods from './AdminPeriods.vue'
import AdminOfferings from './AdminOfferings.vue'
import AdminImport from './AdminImport.vue'
import AdminProposals from './AdminProposals.vue'
import AdminReviews from './AdminReviews.vue'
import AdminRoles from './AdminRoles.vue'

const props = defineProps<{ client: RpcClient; role: 'owner' | 'administrator' }>()
const emit = defineEmits<{ close: []; 'catalog-changed': []; toast: [string] }>()

const admin = new AdminService(props.client)

type SectionKey = 'courses' | 'categories' | 'merge' | 'periods' | 'offerings' | 'import' | 'proposals' | 'reviews' | 'roles'
const activeSection = ref<SectionKey>('courses')
const categories = ref<Category[]>([])
const managedCourses = ref<ManagedCourse[]>([])
const pendingProposalCount = ref(0)
const error = ref('')

type NavItem = { key: SectionKey; label: string; icon: string }
type NavGroup = { label: string; items: NavItem[] }

const navGroups = computed<NavGroup[]>(() => {
  const groups: NavGroup[] = [
    { label: 'ข้อมูลรายวิชา', items: [
      { key: 'courses', label: 'รายวิชา', icon: 'bi-journal-bookmark' },
      { key: 'categories', label: 'หมวดหมู่', icon: 'bi-tags' },
      { key: 'merge', label: 'รวมรายวิชาซ้ำ', icon: 'bi-intersect' },
    ] },
    { label: 'กลุ่มเรียน', items: [
      { key: 'periods', label: 'ภาคการศึกษา', icon: 'bi-calendar3' },
      { key: 'offerings', label: 'กลุ่มเรียน', icon: 'bi-collection' },
      { key: 'import', label: 'นำเข้ารายวิชา', icon: 'bi-upload' },
      { key: 'proposals', label: 'ขอกลุ่มเรียน', icon: 'bi-inbox' },
    ] },
    { label: 'ตรวจสอบ', items: [
      { key: 'reviews', label: 'รีวิว', icon: 'bi-shield-check' },
    ] },
  ]
  if (props.role === 'owner') groups.push({ label: 'ระบบ', items: [{ key: 'roles', label: 'ผู้ดูแลระบบ', icon: 'bi-people' }] })
  return groups
})

async function loadShared() {
  try {
    ;[categories.value, managedCourses.value] = await Promise.all([admin.listCategories(), admin.listManageableCourses()])
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดข้อมูลผู้ดูแลได้' }
  try { pendingProposalCount.value = (await admin.listPendingOfferingProposals()).length }
  catch { /* badge count is best-effort */ }
}

async function onSharedChanged() {
  try {
    ;[categories.value, managedCourses.value] = await Promise.all([admin.listCategories(), admin.listManageableCourses()])
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดข้อมูลผู้ดูแลได้' }
  emit('catalog-changed')
}

function onToast(message: string) { emit('toast', message) }
function onProposalCount(count: number) { pendingProposalCount.value = count }

function selectSection(key: SectionKey, target?: HTMLElement) {
  activeSection.value = key
  try { target?.scrollIntoView({ block: 'nearest', inline: 'center' }) } catch { /* not implemented in some test environments */ }
  nextTick(() => {
    const heading = document.querySelector<HTMLElement>('.admin-content .admin-section-heading')
    heading?.focus()
  })
}

onMounted(loadShared)
</script>

<template>
  <div class="admin-dashboard">
    <header class="course-review-header admin-dashboard-header">
      <div class="d-flex align-items-center gap-3 flex-wrap">
        <button class="btn btn-link text-white p-0 admin-back-btn" @click="emit('close')">← กลับหน้ารายวิชา</button>
        <h1 class="mb-0">แดชบอร์ดผู้ดูแล</h1>
      </div>
      <span class="admin-role-pill">{{ role === 'owner' ? 'เจ้าของระบบ' : 'ผู้ดูแล' }}</span>
    </header>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <div class="admin-layout">
      <nav class="admin-nav" aria-label="เมนูผู้ดูแล">
        <div v-for="group in navGroups" :key="group.label" class="admin-nav-group">
          <div class="admin-nav-group-label">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="admin-nav-item"
            :class="{ active: activeSection === item.key }"
            :aria-current="activeSection === item.key ? 'page' : undefined"
            @click="selectSection(item.key, $event.currentTarget as HTMLElement)"
          >
            <i class="bi" :class="item.icon"></i>
            <span>{{ item.label }}</span>
            <span v-if="item.key === 'proposals' && pendingProposalCount > 0" class="admin-nav-badge">{{ pendingProposalCount }}</span>
          </button>
        </div>
      </nav>
      <div class="admin-content">
        <KeepAlive>
          <AdminCourses v-if="activeSection === 'courses'" :service="admin" :categories="categories" :courses="managedCourses" @changed="onSharedChanged" @toast="onToast" />
          <AdminCategories v-else-if="activeSection === 'categories'" :service="admin" :categories="categories" :courses="managedCourses" @changed="onSharedChanged" @toast="onToast" />
          <AdminMerge v-else-if="activeSection === 'merge'" :service="admin" :courses="managedCourses" @changed="onSharedChanged" @toast="onToast" />
          <AdminPeriods v-else-if="activeSection === 'periods'" :service="admin" @toast="onToast" />
          <AdminOfferings v-else-if="activeSection === 'offerings'" :service="admin" :courses="managedCourses" :client="client" @toast="onToast" />
          <AdminImport v-else-if="activeSection === 'import'" :service="admin" @toast="onToast" />
          <AdminProposals v-else-if="activeSection === 'proposals'" :service="admin" @toast="onToast" @count="onProposalCount" />
          <AdminReviews v-else-if="activeSection === 'reviews'" :service="admin" @toast="onToast" />
          <AdminRoles v-else-if="activeSection === 'roles' && role === 'owner'" :service="admin" @toast="onToast" />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
