<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue'
import { searchKey } from '../../search'
import { AdminService, type Category, type ManagedCourse } from '../../services/admin'

const props = defineProps<{ service: AdminService; categories: Category[]; courses: ManagedCourse[]; loading: boolean; loadError: string; categoriesLoading: boolean; categoriesError: string }>()
const emit = defineEmits<{ changed: []; retry: []; toast: [string] }>()

const error = ref('')
const searchTerm = ref('')
const categoryFilter = ref('')
const statusFilter = ref<'all' | 'approved' | 'archived'>('all')
const modalOpen = ref(false)
const editingCourseId = ref<string | null>(null)
const courseCode = ref('')
const courseName = ref('')
const courseCategoryId = ref('')

const statuses = [{ key: 'all', label: 'ทั้งหมด' }, { key: 'approved', label: 'ใช้งานอยู่' }, { key: 'archived', label: 'อยู่ในคลัง' }] as const
const matchedCourses = computed(() => props.courses.filter((course) => {
  const query = searchKey(searchTerm.value)
  return (!query || searchKey(course.code).includes(query) || searchKey(course.name_th).includes(query)) &&
    (!categoryFilter.value || course.category_id === categoryFilter.value)
}))
const filteredCourses = computed(() => matchedCourses.value.filter((course) => statusFilter.value === 'all' || course.status === statusFilter.value))
function statusCount(status: string) { return status === 'all' ? matchedCourses.value.length : matchedCourses.value.filter((course) => course.status === status).length }
const sentinel = ref<HTMLElement | null>(null)
const toolbar = ref<HTMLElement | null>(null)
const results = ref<HTMLElement | null>(null)
const stuck = ref(false)
function updateScrollState() { stuck.value = (sentinel.value?.getBoundingClientRect().top ?? 0) < 0 }
function stopScrollListener() { window.removeEventListener('scroll', updateScrollState) }
onActivated(() => { window.addEventListener('scroll', updateScrollState, { passive: true }); updateScrollState() })
onDeactivated(stopScrollListener)
onBeforeUnmount(stopScrollListener)
watch([searchTerm, categoryFilter, statusFilter], async () => {
  updateScrollState()
  const reposition = stuck.value
  await nextTick()
  if (reposition && results.value && toolbar.value) {
    window.scrollTo({ top: window.scrollY + results.value.getBoundingClientRect().top - toolbar.value.getBoundingClientRect().height, behavior: 'instant' })
    updateScrollState()
  }
})

function openAddModal() {
  editingCourseId.value = null
  courseCode.value = ''
  courseName.value = ''
  courseCategoryId.value = props.categories[0]?.id ?? ''
  error.value = ''
  modalOpen.value = true
}
function openEditModal(course: ManagedCourse) {
  editingCourseId.value = course.id
  courseCode.value = course.code
  courseName.value = course.name_th
  courseCategoryId.value = course.category_id
  error.value = ''
  modalOpen.value = true
}
function closeModal() { modalOpen.value = false }

async function submit() {
  const draft = { code: courseCode.value, nameTh: courseName.value, categoryId: courseCategoryId.value }
  try {
    const wasEditing = Boolean(editingCourseId.value)
    if (wasEditing) await props.service.updateCourse(editingCourseId.value as string, draft)
    else await props.service.createCourse(draft)
    modalOpen.value = false
    emit('changed')
    emit('toast', wasEditing ? 'บันทึกรายวิชาสำเร็จ' : 'เพิ่มรายวิชาสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถบันทึกรายวิชาได้' }
}

async function archive(course: ManagedCourse) {
  if (!window.confirm(`ต้องการเก็บ ${course.code} เข้าคลังใช่หรือไม่?`)) return
  try {
    await props.service.archiveCourse(course.id)
    emit('changed')
    emit('toast', 'เก็บรายวิชาเข้าคลังสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเก็บรายวิชาเข้าคลังได้' }
}
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">รายวิชา</h2>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <div ref="sentinel" class="admin-toolbar-sentinel" aria-hidden="true"></div>
    <div ref="toolbar" class="admin-course-toolbar" :class="{ 'is-stuck': stuck }">
      <div class="admin-course-search">
        <label class="section-label-sm" for="admin-course-search">ค้นหา</label>
        <div class="admin-search-wrap">
          <input id="admin-course-search" v-model="searchTerm" class="form-control" placeholder="รหัสวิชา หรือ ชื่อวิชา" />
          <button v-if="searchTerm" class="admin-search-clear" aria-label="ล้างคำค้นหา" @click="searchTerm = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </div>
      </div>
      <div class="admin-course-category">
        <label class="section-label-sm" for="admin-course-category">หมวดหมู่</label>
        <select id="admin-course-category" :disabled="categoriesLoading || !!categoriesError" v-model="categoryFilter" class="form-select">
          <option value="">ทุกหมวดหมู่</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
      </div>
      <div class="admin-status-chips" aria-label="สถานะรายวิชา">
        <button v-for="status in statuses" :key="status.key" class="category-btn" :class="{ active: statusFilter === status.key, 'is-empty': !loading && !loadError && statusCount(status.key) === 0 }" :aria-pressed="statusFilter === status.key" @click="statusFilter = status.key">{{ status.label }}<span v-if="!loading && !loadError" class="admin-chip-count">{{ statusCount(status.key) }}</span></button>
      </div>
      <button class="btn btn-purple admin-course-add" :disabled="categoriesLoading || !!categoriesError" @click="openAddModal"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>เพิ่มรายวิชา</button>
    </div>
    <div v-if="categoriesError" class="admin-load-error" role="alert">{{ categoriesError }} <button class="btn btn-outline-purple" @click="emit('retry')">ลองใหม่</button></div>
    <div ref="results" class="admin-course-results" :aria-busy="loading && !courses.length">
      <div v-if="loading && !courses.length" aria-label="กำลังโหลดรายวิชา"><div v-for="n in 6" :key="n" class="admin-skeleton-row" aria-hidden="true"></div></div>
      <template v-else>
        <div v-if="loadError" class="admin-load-error" role="alert">{{ loadError }} <button class="btn btn-outline-purple" @click="emit('retry')">ลองใหม่</button></div>
        <p v-if="!loading && !loadError" class="visually-hidden" role="status" aria-live="polite">พบ {{ filteredCourses.length }} รายวิชา</p>
        <table v-if="filteredCourses.length" class="admin-table admin-course-table" role="table" aria-label="รายวิชา">
          <thead role="rowgroup"><tr role="row"><th role="columnheader">รหัสวิชา</th><th role="columnheader">ชื่อวิชา</th><th role="columnheader">หมวดหมู่</th><th role="columnheader">สถานะ</th><th role="columnheader" class="admin-actions-cell"><span class="visually-hidden">การจัดการ</span></th></tr></thead>
          <tbody role="rowgroup">
            <tr v-for="course in filteredCourses" :key="course.id" role="row" :class="{ 'is-archived': course.status === 'archived' }">
              <td role="cell" class="admin-course-code">{{ course.code }}</td>
              <td role="cell" class="admin-course-name">{{ course.name_th }}</td>
              <td role="cell" class="admin-course-category-cell">{{ course.category_name }}</td>
              <td role="cell" class="admin-course-state"><span class="admin-state-badge" :class="course.status === 'approved' ? 'admin-state-visible' : 'admin-state-neutral'">{{ course.status === 'approved' ? 'ใช้งานอยู่' : 'อยู่ในคลัง' }}</span></td>
              <td role="cell" class="admin-actions-cell"><div class="admin-row-actions">
                <button class="btn btn-sm btn-outline-purple" :disabled="categoriesLoading || !!categoriesError" :aria-label="`แก้ไข ${course.code}`" @click="openEditModal(course)">แก้ไข</button>
                <button v-if="course.status === 'approved'" class="btn btn-sm btn-outline-danger" :aria-label="`เก็บเข้าคลัง ${course.code}`" @click="archive(course)"><i class="bi bi-archive me-1" aria-hidden="true"></i>เก็บเข้าคลัง</button>
              </div></td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!loadError" class="admin-empty">
          <p>ไม่พบรายวิชาที่ตรงกับ “{{ searchTerm }}”</p>
          <div class="d-flex flex-wrap gap-2">
            <button v-if="searchTerm" class="btn btn-outline-purple" @click="searchTerm = ''">ล้างคำค้นหา</button>
            <button v-if="categoryFilter" class="btn btn-outline-purple" @click="categoryFilter = ''">ทุกหมวดหมู่</button>
            <button v-if="statusFilter !== 'all'" class="btn btn-outline-purple" @click="statusFilter = 'all'">ทุกสถานะ</button>
          </div>
        </div>
      </template>
    </div>
    <div v-if="modalOpen" class="contact-panel" role="dialog" aria-modal="true" :aria-label="editingCourseId ? 'แก้ไขรายวิชา' : 'เพิ่มรายวิชา'" @click.self="closeModal">
      <div class="contact-modal-card">
        <div class="contact-modal-header">
          <h3 class="modal-title text-purple mb-0 h5">{{ editingCourseId ? 'แก้ไขรายวิชา' : 'เพิ่มรายวิชา' }}</h3>
          <button class="btn-close" aria-label="ปิด" @click="closeModal"></button>
        </div>
        <div class="course-modal-body">
          <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
          <div class="mb-3">
            <label for="admin-course-code">รหัสวิชา</label>
            <input id="admin-course-code" v-model="courseCode" class="form-control" />
          </div>
          <div class="mb-3">
            <label for="admin-course-name">ชื่อรายวิชา</label>
            <input id="admin-course-name" v-model="courseName" class="form-control" />
          </div>
          <div class="mb-4">
            <label for="admin-course-category-select">หมวดหมู่</label>
            <select id="admin-course-category-select" v-model="courseCategoryId" class="form-select">
              <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
            </select>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary flex-grow-1" @click="closeModal">ยกเลิก</button>
            <button class="btn btn-purple flex-grow-1" @click="submit">{{ editingCourseId ? 'บันทึก' : 'เพิ่มรายวิชา' }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
