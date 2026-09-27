<script setup lang="ts">
import { computed, ref } from 'vue'
import { AdminService, type ManagedCourse, type OfferingSummary } from '../../services/admin'
import type { RpcClient } from '../../services/reviews'

const props = defineProps<{ service: AdminService; courses: ManagedCourse[]; client: RpcClient }>()
const emit = defineEmits<{ toast: [string] }>()

const error = ref('')
const courseSearch = ref('')
const courseId = ref('')
const courseOfferings = ref<OfferingSummary[]>([])
const editingOfferingId = ref<string | null>(null)

const year = ref(new Date().getFullYear() + 543)
const semester = ref('1')
const section = ref('')
const instructor = ref('')
const day = ref(1)
const start = ref('09:00')
const end = ref('12:00')
const dayNames = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']

const approvedCourses = computed(() => props.courses.filter((course) => course.status === 'approved'))
const filteredCourseOptions = computed(() => {
  const search = courseSearch.value.trim().toLowerCase()
  return !search ? approvedCourses.value : approvedCourses.value.filter((course) => `${course.code} ${course.name_th}`.toLowerCase().includes(search))
})

function timeValue(time: string) { return time.slice(0, 5) }

async function loadCourseOfferings() {
  editingOfferingId.value = null
  if (!courseId.value) { courseOfferings.value = []; return }
  try { courseOfferings.value = await props.service.listOfferings(courseId.value) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดกลุ่มเรียนได้' }
}

function resetForm() {
  editingOfferingId.value = null
  section.value = ''
  instructor.value = ''
  day.value = 1
  start.value = '09:00'
  end.value = '12:00'
}

async function editOffering(offering: OfferingSummary) {
  editingOfferingId.value = offering.id
  year.value = offering.academic_year
  semester.value = offering.semester
  section.value = offering.section
  instructor.value = offering.instructor_name ?? ''
  try {
    const result = await props.client.rpc('list_approved_offering_meetings', { p_offering_id: offering.id })
    if (result.error) throw new Error(result.error.message)
    const meeting = ((result.data ?? []) as Array<{ day_of_week: number; starts_at: string; ends_at: string }>)[0]
    if (meeting) { day.value = meeting.day_of_week; start.value = timeValue(meeting.starts_at); end.value = timeValue(meeting.ends_at) }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดเวลาเรียนได้' }
}

async function save() {
  const draft = { courseId: courseId.value, academicYear: year.value, semester: semester.value, section: section.value, instructorName: instructor.value, day: day.value, startsAt: start.value, endsAt: end.value }
  try {
    const wasEditing = Boolean(editingOfferingId.value)
    if (wasEditing) await props.service.updateOffering(editingOfferingId.value as string, draft)
    else await props.service.createOffering(draft)
    resetForm()
    await loadCourseOfferings()
    emit('toast', 'บันทึกกลุ่มเรียนสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถบันทึกกลุ่มเรียนได้' }
}
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">กลุ่มเรียน</h2>
    <p class="admin-section-desc">เลือกรายวิชาแล้วเพิ่มหรือแก้ไขกลุ่มเรียน</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <div class="row g-2 mb-3">
      <div class="col-md-4">
        <label class="section-label-sm" for="admin-offering-course-search">ค้นหารายวิชา</label>
        <input id="admin-offering-course-search" v-model="courseSearch" class="form-control" placeholder="พิมพ์รหัสหรือชื่อวิชา" />
      </div>
      <div class="col-md-4">
        <label class="section-label-sm" for="admin-offering-course">รายวิชา</label>
        <select id="admin-offering-course" v-model="courseId" class="form-select" @change="loadCourseOfferings">
          <option value="">เลือกรายวิชา</option>
          <option v-for="course in filteredCourseOptions" :key="course.id" :value="course.id">{{ course.code }} · {{ course.name_th }}</option>
        </select>
      </div>
    </div>
    <template v-if="courseId">
      <h3 class="h6">กลุ่มเรียนที่มีอยู่</h3>
      <p v-if="!courseOfferings.length" class="text-muted">ยังไม่มีกลุ่มเรียนสำหรับรายวิชานี้</p>
      <ul v-else class="list-group admin-flex-list mb-3">
        <li v-for="offering in courseOfferings" :key="offering.id" class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
          <span>กลุ่ม {{ offering.section }} · {{ offering.semester }}/{{ offering.academic_year }}
            <small v-if="offering.instructor_name" class="text-muted"> · {{ offering.instructor_name }}</small>
          </span>
          <button class="btn btn-sm btn-outline-purple" @click="editOffering(offering)">แก้ไข</button>
        </li>
      </ul>
      <h3 class="h6">{{ editingOfferingId ? 'แก้ไขกลุ่มเรียน' : 'เพิ่มกลุ่มเรียน' }}</h3>
      <div class="row g-2">
        <div class="col-md-2">
          <label class="section-label-sm" for="admin-offering-year">ปีการศึกษา</label>
          <input id="admin-offering-year" v-model.number="year" class="form-control" type="number" />
        </div>
        <div class="col-md-2">
          <label class="section-label-sm" for="admin-offering-semester">ภาค</label>
          <input id="admin-offering-semester" v-model="semester" class="form-control" />
        </div>
        <div class="col-md-2">
          <label class="section-label-sm" for="admin-offering-section">กลุ่ม</label>
          <input id="admin-offering-section" v-model="section" class="form-control" />
        </div>
        <div class="col-md-3">
          <label class="section-label-sm" for="admin-offering-instructor">ผู้สอน</label>
          <input id="admin-offering-instructor" v-model="instructor" class="form-control" />
        </div>
        <div class="col-md-3">
          <label class="section-label-sm" for="admin-offering-day">วัน</label>
          <select id="admin-offering-day" v-model.number="day" class="form-select">
            <option v-for="d in [1, 2, 3, 4, 5, 6, 7]" :key="d" :value="d">{{ dayNames[d] }}</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="section-label-sm" for="admin-offering-start">เวลาเริ่ม</label>
          <input id="admin-offering-start" v-model="start" class="form-control" type="time" />
        </div>
        <div class="col-md-3">
          <label class="section-label-sm" for="admin-offering-end">เวลาเลิก</label>
          <input id="admin-offering-end" v-model="end" class="form-control" type="time" />
        </div>
        <div class="col-md-3 d-flex align-items-end gap-2">
          <button v-if="editingOfferingId" class="btn btn-outline-secondary flex-grow-1" @click="resetForm">ยกเลิก</button>
          <button class="btn btn-purple flex-grow-1" @click="save">{{ editingOfferingId ? 'บันทึกกลุ่มเรียน' : 'เพิ่มกลุ่มเรียน' }}</button>
        </div>
      </div>
    </template>
    <p v-else class="text-muted">เลือกรายวิชาเพื่อดูและแก้ไขกลุ่มเรียน</p>
  </div>
</template>
