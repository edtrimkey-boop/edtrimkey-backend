import { supabase } from '../lib/supabase.js'

export default async function handler(req, res) {
  const { action } = req.query

  try {

    // 🆕 CREATE JOB
    if (action === "create") {
      const { institute_code, job_type, requester_id, meta_data } = req.body

      const { data: counter } = await supabase
        .from('job_counters')
        .select('last_number')
        .eq('institute_code', institute_code)
        .single()

      const nextNumber = (counter?.last_number || 0) + 1

      const job_id = `TK-${institute_code}-${String(nextNumber).padStart(4, '0')}`

      await supabase.from('job_counters').upsert({
        institute_code,
        last_number: nextNumber
      })

      await supabase.from('jobs_queue').insert([{
        job_id,
        institute_code,
        job_type,
        requester_id,
        meta_data,
        status: 'Pending'
      }])

      return res.json({ success: true, data: { job_id } })
    }

    // 📋 LIST JOBS
    if (action === "list") {
      const { institute_code } = req.query

      const { data } = await supabase
        .from('jobs_queue')
        .select('job_id, job_type, status, created_at')
        .eq('institute_code', institute_code)
        .order('created_at', { ascending: false })
        .limit(50)

      return res.json({ success: true, data })
    }

    // 👨‍💻 ASSIGN
    if (action === "assign") {
      const { job_id, operator_id } = req.body

      await supabase
        .from('jobs_queue')
        .update({ operator_id, status: 'Assigned' })
        .eq('job_id', job_id)

      return res.json({ success: true })
    }

    // ✅ COMPLETE
    if (action === "complete") {
      const { job_id, file_url } = req.body

      await supabase
        .from('jobs_queue')
        .update({ status: 'Completed', final_file_url: file_url })
        .eq('job_id', job_id)

      return res.json({ success: true })
    }

    return res.status(400).json({ success: false, error: "Invalid action" })

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}