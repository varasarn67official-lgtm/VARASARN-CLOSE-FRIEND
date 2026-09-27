<script setup lang="ts">
import { ref } from 'vue'
import { AdminService, type BulkOfferingResult, type BulkOfferingRow, type OfferingImportPreview } from '../../services/admin'

const props = defineProps<{ service: AdminService }>()
const emit = defineEmits<{ toast: [string] }>()

const error = ref('')
const bulkImportText = ref('')
const preview = ref<OfferingImportPreview[]>([])
const result = ref<BulkOfferingResult | null>(null)

const exampleJson = '[{"courseCode":"JC100","academicYear":2569,"semester":"1","section":"2","instructorName":"อาจารย์เอ","dayOfWeek":2,"startsAt":"09:00","endsAt":"11:00"}]'

function parseRows(): unknown[] {
  const parsed = JSON.parse(bulkImportText.value)
  if (!Array.isArray(parsed)) throw new Error('ข้อมูลต้องเป็นรายการ (array) ของกลุ่มเรียน')
  return parsed
}

async function previewImport() {
  result.value = null
  error.value = ''
  try { preview.value = await props.service.previewOfferingImport(parseRows()) }
  catch (cause) { preview.value = []; error.value = cause instanceof Error ? cause.message : 'ไม่สามารถตรวจสอบข้อมูลนำเข้าได้' }
}

async function confirmImport() {
  try {
    result.value = await props.service.bulkImportOfferings(parseRows() as BulkOfferingRow[])
    preview.value = []
    bulkImportText.value = ''
    emit('toast', 'นำเข้ากลุ่มเรียนสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถนำเข้ากลุ่มเรียนได้' }
}

function actionLabel(row: OfferingImportPreview) {
  if (!row.valid) return 'ผิดพลาด'
  return row.action === 'create' ? 'เพิ่มใหม่' : row.action === 'update' ? 'แก้ไข' : 'ไม่เปลี่ยนแปลง'
}
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">นำเข้ารายวิชา</h2>
    <p class="admin-section-desc">นำเข้ากลุ่มเรียนจำนวนมากด้วย JSON: วาง → ตรวจสอบ → ยืนยัน</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <ol class="admin-steps">
      <li>
        <h3 class="h6">1. วางข้อมูล</h3>
        <p class="text-muted mb-2">วางข้อมูลเป็นรายการ JSON ของกลุ่มเรียน เช่น</p>
        <pre class="admin-code-example"><code>{{ exampleJson }}</code></pre>
        <textarea v-model="bulkImportText" class="form-control" rows="5" aria-label="ข้อมูลนำเข้ากลุ่มเรียน (JSON)" :placeholder="exampleJson"></textarea>
      </li>
      <li>
        <h3 class="h6">2. ตรวจสอบ</h3>
        <button class="btn btn-outline-purple" :disabled="!bulkImportText.trim()" @click="previewImport">ตรวจสอบ</button>
        <template v-if="preview.length">
          <p class="admin-import-totals">
            เพิ่มใหม่ {{ preview.filter((row) => row.valid && row.action === 'create').length }} ·
            แก้ไข {{ preview.filter((row) => row.valid && row.action === 'update').length }} ·
            ไม่เปลี่ยนแปลง {{ preview.filter((row) => row.valid && row.action === 'existing').length }} ·
            ผิดพลาด {{ preview.filter((row) => !row.valid).length }}
          </p>
          <div class="table-responsive admin-import-table">
            <table class="table table-sm align-middle">
              <thead>
                <tr><th>แถว</th><th>วิชา</th><th>ภาค/ปี</th><th>กลุ่ม</th><th>สถานะ</th><th>หมายเหตุ</th></tr>
              </thead>
              <tbody>
                <tr v-for="row in preview" :key="row.rowNumber">
                  <td>{{ row.rowNumber }}</td>
                  <td>{{ row.courseCode }}</td>
                  <td>{{ row.semester }}/{{ row.academicYear }}</td>
                  <td>{{ row.section }}</td>
                  <td><span :class="row.valid ? 'text-success' : 'text-danger'">{{ actionLabel(row) }}</span></td>
                  <td class="text-muted">{{ row.reason }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </li>
      <li>
        <h3 class="h6">3. ยืนยัน</h3>
        <button class="btn btn-purple" :disabled="!preview.length" @click="confirmImport">ยืนยันนำเข้า</button>
        <p v-if="result" class="alert alert-success mt-2">
          นำเข้าสำเร็จ: เพิ่มใหม่ {{ result.created_count }} · แก้ไข {{ result.updated_count }} · ไม่เปลี่ยนแปลง {{ result.existing_count }}
        </p>
      </li>
    </ol>
  </div>
</template>
