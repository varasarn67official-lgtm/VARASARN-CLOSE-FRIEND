import type { RpcClient } from './reviews'

export type OfferingProposal = { id: string; courseId: string; academicYear: number; semester: string; section: string; instructorName: string | null; status: 'pending' | 'approved' | 'rejected'; createdAt: string }

export class ProposalService {
  constructor(private readonly client: RpcClient) {}
  async create(courseId: string, academicYear: number, semester: string, section: string, instructorName: string): Promise<void> {
    if (!courseId || !Number.isInteger(academicYear) || !semester.trim() || !section.trim()) throw new Error('กรอกข้อมูลกลุ่มเรียนให้ครบถ้วน')
    const { error } = await this.client.rpc('create_offering_proposal', { p_course_id: courseId, p_academic_year: academicYear, p_semester: semester.trim(), p_section: section.trim(), p_instructor_name: instructorName.trim() })
    if (error) throw new Error(error.message)
  }
  async listMine(): Promise<OfferingProposal[]> {
    const { data, error } = await this.client.rpc('list_my_offering_proposals')
    if (error) throw new Error(error.message)
    return ((data ?? []) as Array<{ id: string; course_id: string; academic_year: number; semester: string; section: string; instructor_name: string | null; status: OfferingProposal['status']; created_at: string }>).map((proposal) => ({ id: proposal.id, courseId: proposal.course_id, academicYear: proposal.academic_year, semester: proposal.semester, section: proposal.section, instructorName: proposal.instructor_name, status: proposal.status, createdAt: proposal.created_at }))
  }
}
