<script setup lang="ts">
import { computed, ref } from 'vue'
import { AdminService, type ManagedCourse, type MergePreview } from '../../services/admin'

const props = defineProps<{ service: AdminService; courses: ManagedCourse[] }>()
const emit = defineEmits<{ changed: []; toast: [string] }>()

const error = ref('')
const sourceId = ref('')
const targetId = ref('')
const preview = ref<MergePreview | null>(null)

const approvedCourses = computed(() => props.courses.filter((course) => course.status === 'approved'))
const targetOptions = computed(() => approvedCourses.value.filter((course) => course.id !== sourceId.value))

async function previewMerge() {
  if (!sourceId.value || !targetId.value) return
  try { preview.value = await props.service.previewCourseMerge(sourceId.value, targetId.value); error.value = '' }
  catch (cause) { preview.value = null; error.value = cause instanceof Error ? cause.message : 'ไม่สามารถตรวจสอบการรวมรายวิชาได้' }
}

async function confirmMerge() {
  if (!preview.value) return
  if (!window.confirm(`รวม ${preview.value.source_code} เข้ากับ ${preview.value.target_code} ใช่หรือไม่?`)) return
  try {
    await props.service.mergeCourse(sourceId.value, targetId.value)
    preview.value = null
    sourceId.value = ''
    targetId.value = ''
    emit('changed')
    emit('toast', 'รวมรายวิชาสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถรวมรายวิชาได้' }
}
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">รวมรายวิชาซ้ำ</h2>
    <p class="admin-section-desc">รวมรายวิชาต้นทางเข้ากับรายวิชาที่เก็บไว้</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <div class="admin-merge-row">
      <div class="admin-merge-field">
        <label class="section-label-sm" for="admin-merge-source">รายวิชาต้นทาง</label>
        <select id="admin-merge-source" v-model="sourceId" class="form-select">
          <option value="">เลือกรายวิชาต้นทาง</option>
          <option v-for="course in approvedCourses" :key="course.id" :value="course.id">{{ course.code }} · {{ course.name_th }}</option>
        </select>
      </div>
      <i class="bi bi-arrow-right admin-merge-arrow" aria-hidden="true"></i>
      <div class="admin-merge-field">
        <label class="section-label-sm" for="admin-merge-target">รายวิชาที่เก็บไว้</label>
        <select id="admin-merge-target" v-model="targetId" class="form-select">
          <option value="">เลือกรายวิชาที่เก็บไว้</option>
          <option v-for="course in targetOptions" :key="course.id" :value="course.id">{{ course.code }} · {{ course.name_th }}</option>
        </select>
      </div>
      <button class="btn btn-outline-purple" @click="previewMerge">ตรวจสอบ</button>
    </div>
    <div v-if="preview" class="review-box mt-3">
      <p class="mb-2">ย้าย {{ preview.offerings_to_move }} กลุ่มเรียน และเก็บ {{ preview.reviews_preserved }} รีวิว จาก
        <strong>{{ preview.source_code }}</strong> ไปยัง <strong>{{ preview.target_code }}</strong></p>
      <button class="btn btn-purple" @click="confirmMerge">ยืนยันการรวม</button>
    </div>
  </div>
</template>
