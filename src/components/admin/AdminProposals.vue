<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AdminService, type PendingProposal } from '../../services/admin'

const props = defineProps<{ service: AdminService }>()
const emit = defineEmits<{ toast: [string]; count: [number] }>()

const proposals = ref<PendingProposal[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  try { proposals.value = await props.service.listPendingOfferingProposals(); emit('count', proposals.value.length) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถโหลดข้อเสนอกลุ่มเรียนได้' }
  finally { loading.value = false }
}

async function resolve(id: string, approve: boolean) {
  try {
    await props.service.resolveOfferingProposal(id, approve)
    await load()
    emit('toast', approve ? 'อนุมัติข้อเสนอสำเร็จ' : 'ปฏิเสธข้อเสนอสำเร็จ')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'ไม่สามารถดำเนินการข้อเสนอได้' }
}

onMounted(load)
</script>

<template>
  <div class="admin-section">
    <h2 tabindex="-1" class="admin-section-heading">ขอกลุ่มเรียน</h2>
    <p class="admin-section-desc">ระบบเปิดให้เพิ่มกลุ่มเรียนใหม่ได้ทันทีโดยไม่ต้องรออนุมัติในขณะนี้ รายการที่รอตรวจสอบจะปรากฏที่นี่หากเปิดใช้การตรวจสอบอีกครั้ง</p>
    <p v-if="error" class="alert alert-danger" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-muted">กำลังโหลดข้อมูล...</p>
    <template v-else>
      <p v-if="!proposals.length" class="text-muted">ไม่มีข้อเสนอที่รอตรวจสอบ</p>
      <div v-for="proposal in proposals" :key="proposal.id" class="review-box">
        <div class="d-flex flex-wrap justify-content-between gap-2 align-items-center">
          <span><strong>{{ proposal.course_code }}</strong> · กลุ่ม {{ proposal.section }} · {{ proposal.semester }}/{{ proposal.academic_year }}
            <small v-if="proposal.instructor_name" class="d-block text-muted">{{ proposal.instructor_name }}</small>
          </span>
          <span class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-danger" @click="resolve(proposal.id, false)">ปฏิเสธ</button>
            <button class="btn btn-sm btn-purple" @click="resolve(proposal.id, true)">อนุมัติ</button>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
