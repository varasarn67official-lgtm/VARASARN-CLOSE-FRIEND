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
const coursesLoading = ref(true)
const categoriesLoading = ref(true)
const coursesError = ref('')
const categoriesError = ref('')

type NavItem = { key: SectionKey; label: string; icon: string }
// Re-enable a retained section by adding its key here.
const enabledSections: SectionKey[] = ['courses', 'categories', 'reviews']
const sectionItems: NavItem[] = [
  { key: 'courses', label: 'รายวิชา', icon: 'bi-journal-bookmark' },
  { key: 'categories', label: 'หมวดหมู่', icon: 'bi-tags' },
  { key: 'merge', label: 'รวมรายวิชาซ้ำ', icon: 'bi-intersect' },
  { key: 'periods', label: 'ภาคการศึกษา', icon: 'bi-calendar3' },
  { key: 'offerings', label: 'กลุ่มเรียน', icon: 'bi-collection' },
  { key: 'import', label: 'นำเข้ารายวิชา', icon: 'bi-upload' },
  { key: 'proposals', label: 'ขอกลุ่มเรียน', icon: 'bi-inbox' },
  { key: 'reviews', label: 'รีวิว', icon: 'bi-shield-check' },
  { key: 'roles', label: 'ผู้ดูแลระบบ', icon: 'bi-people' },
]
const navItems = computed(() => enabledSections.map((key) => sectionItems.find((item) => item.key === key)!).filter((item) => item.key !== 'roles' || props.role === 'owner'))

async function loadCourses() {
  coursesLoading.value = true
  coursesError.value = ''
  try { managedCourses.value = await admin.listManageableCourses() }
  catch { coursesError.value = 'โหลดรายวิชาไม่สำเร็จ' }
  finally { coursesLoading.value = false }
}
async function loadCategories() {
  categoriesLoading.value = true
  categoriesError.value = ''
  try { categories.value = await admin.listCategories() }
  catch { categoriesError.value = 'โหลดหมวดหมู่ไม่สำเร็จ' }
  finally { categoriesLoading.value = false }
}
async function loadShared() { await Promise.all([loadCourses(), loadCategories()]) }
async function onSharedChanged() {
  await loadShared()
  emit('catalog-changed')
}

function onToast(message: string) { emit('toast', message) }

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
    </header>
    <div class="admin-layout">
      <nav class="admin-nav" aria-label="เมนูผู้ดูแล">
          <button
            v-for="item in navItems"
            :key="item.key"
            type="button"
            class="admin-nav-item"
            :class="{ active: activeSection === item.key }"
            :aria-current="activeSection === item.key ? 'page' : undefined"
            @click="selectSection(item.key, $event.currentTarget as HTMLElement)"
          >
            <i class="bi" :class="item.icon"></i>
            <span>{{ item.label }}</span>
          </button>
      </nav>
      <div class="admin-content">
        <KeepAlive v-if="enabledSections.includes(activeSection)">
          <AdminCourses :categories-loading="categoriesLoading" :categories-error="categoriesError" :loading="coursesLoading" :load-error="coursesError" @retry="loadShared" v-if="activeSection === 'courses'" :service="admin" :categories="categories" :courses="managedCourses" @changed="onSharedChanged" @toast="onToast" />
          <AdminCategories :loading="categoriesLoading" :load-error="categoriesError" :counts-loading="coursesLoading" :counts-error="coursesError" @retry="loadShared" v-else-if="activeSection === 'categories'" :service="admin" :categories="categories" :courses="managedCourses" @changed="onSharedChanged" @toast="onToast" />
          <AdminMerge v-else-if="activeSection === 'merge'" :service="admin" :courses="managedCourses" @changed="onSharedChanged" @toast="onToast" />
          <AdminPeriods v-else-if="activeSection === 'periods'" :service="admin" @toast="onToast" />
          <AdminOfferings v-else-if="activeSection === 'offerings'" :service="admin" :courses="managedCourses" :client="client" @toast="onToast" />
          <AdminImport v-else-if="activeSection === 'import'" :service="admin" @toast="onToast" />
          <AdminProposals v-else-if="activeSection === 'proposals'" :service="admin" @toast="onToast" />
          <AdminReviews v-else-if="activeSection === 'reviews'" :service="admin" @toast="onToast" />
          <AdminRoles v-else-if="activeSection === 'roles' && role === 'owner'" :service="admin" @toast="onToast" />
        </KeepAlive>
      </div>
    </div>
  </div>
</template>
