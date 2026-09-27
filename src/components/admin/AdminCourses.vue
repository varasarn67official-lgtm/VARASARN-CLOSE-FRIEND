<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AdminService, type Category, type ManagedCourse } from '../../services/admin'

const props = defineProps<{ service: AdminService; categories: Category[]; courses: ManagedCourse[] }>()
const emit = defineEmits<{ changed: []; toast: [string] }>()

const loading = ref(true)
const error = ref('')
const searchTerm = ref('')
const categoryFilter = ref('')
const statusFilter = ref<'all' | 'approved' | 'archived'>('all')
const modalOpen = ref(false)
const editingCourseId = ref<string | null>(null)
const courseCode = ref('')
const courseName = ref('')
const courseCategoryId = ref('')

const filteredCourses = computed(() => props.courses.filter((course) => {
  const search = searchTerm.value.trim().toLowerCase()
  const matchesSearch = !search || `${course.code} ${course.name_th}`.toLowerCase().includes(search)
  const matchesCategory = !categoryFilter.value || course.category_id === categoryFilter.value
  const matchesStatus = statusFilter.value === 'all' || course.status === statusFilter.value
  return matchesSearch && matchesCategory && matchesStatus
}))

onMounted(() => { loading.value = false })

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
    <p class="admin-section-desc">ค้นหา เพิ่ม แก้ไข และเก็บรายวิชาเข้าคลัง</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-muted">กำลังโหลดข้อมูล...</p>
    <template v-else>
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div class="row g-2 flex-grow-1">
          <div class="col-md-4">
            <label class="section-label-sm" for="admin-course-search">ค้นหา</label>
            <input id="admin-course-search" v-model="searchTerm" class="form-control" placeholder="รหัสวิชา หรือ ชื่อวิชา" />
          </div>
          <div class="col-md-4">
            <label class="section-label-sm" for="admin-course-category">หมวดหมู่</label>
            <select id="admin-course-category" v-model="categoryFilter" class="form-select">
              <option value="">ทุกหมวดหมู่</option>
              <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="section-label-sm" for="admin-course-status">สถานะ</label>
            <select id="admin-course-status" v-model="statusFilter" class="form-select">
              <option value="all">ทุกสถานะ</option>
              <option value="approved">ใช้งานอยู่</option>
              <option value="archived">เก็บเข้าคลัง</option>
            </select>
          </div>
        </div>
        <button class="btn btn-purple" @click="openAddModal"><i class="bi bi-plus-lg me-1"></i>เพิ่มรายวิชา</button>
      </div>
      <p class="text-muted small">พบ {{ filteredCourses.length }} รายวิชา</p>
      <ul class="list-group admin-flex-list">
        <li v-for="course in filteredCourses" :key="course.id" class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span><strong>{{ course.code }}</strong> · {{ course.name_th }}
            <small class="text-muted">{{ course.category_name }} · {{ course.status === 'approved' ? 'ใช้งานอยู่' : 'เก็บเข้าคลัง' }}</small>
          </span>
          <span class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-purple" @click="openEditModal(course)">แก้ไข</button>
            <button v-if="course.status === 'approved'" class="btn btn-sm btn-outline-danger" @click="archive(course)">เก็บเข้าคลัง</button>
          </span>
        </li>
      </ul>
      <p v-if="!filteredCourses.length" class="text-muted">ไม่พบรายวิชาที่ตรงกับการค้นหา</p>
    </template>
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
