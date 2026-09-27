<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AdminService, type AcademicPeriod } from '../../services/admin'

const props = defineProps<{ service: AdminService }>()
const emit = defineEmits<{ toast: [string] }>()

const periods = ref<AcademicPeriod[]>([])
const loading = ref(true)
const error = ref('')
const year = ref(new Date().getFullYear() + 543)
const semester = ref('1')

async function load() {
  loading.value = true
  try { periods.value = await props.service.listAcademicPeriods() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดภาคการศึกษาได้' }
  finally { loading.value = false }
}

async function addPeriod() {
  try {
    await props.service.createAcademicPeriod(year.value, semester.value)
    await load()
    emit('toast', 'เพิ่มภาคการศึกษาสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถเพิ่มภาคการศึกษาได้' }
}

onMounted(load)
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">ภาคการศึกษา</h2>
    <p class="admin-section-desc">เพิ่มภาคการศึกษาและดูภาคที่มีอยู่แล้ว</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <div class="row g-2 mb-3">
      <div class="col-md-4">
        <label class="section-label-sm" for="admin-period-year">ปีการศึกษา</label>
        <input id="admin-period-year" v-model.number="year" class="form-control" type="number" />
      </div>
      <div class="col-md-5">
        <label class="section-label-sm" for="admin-period-semester">ภาคการศึกษา</label>
        <input id="admin-period-semester" v-model="semester" class="form-control" />
      </div>
      <div class="col-md-3 d-flex align-items-end">
        <button class="btn btn-purple w-100" @click="addPeriod">เพิ่มภาคการศึกษา</button>
      </div>
    </div>
    <p v-if="loading" class="text-muted">กำลังโหลดข้อมูล...</p>
    <template v-else>
      <div v-if="!periods.length" class="review-box text-muted">ยังไม่มีภาคการศึกษา</div>
      <div v-else class="admin-term-chips">
        <span v-for="period in periods" :key="period.id" class="offering-term admin-term-chip">{{ period.semester }}/{{ period.academic_year }}</span>
      </div>
    </template>
  </div>
</template>
