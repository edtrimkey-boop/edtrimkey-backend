import { supabase } from '../lib/supabase.js'

export default async function handler(req, res) {
  const { action } = req.query

  try {

    // 👤 PROFILE
    if (action === "profile") {
      const token = req.headers.authorization?.replace('Bearer ', '')

      const { data: authData } = await supabase.auth.getUser(token)

      const { data } = await supabase
        .from('users')
        .select(`
          id,
          full_name,
          role,
          institute_code,
          institutes (
            institute_name,
            app_toggles,
            quotas
          )
        `)
        .eq('auth_user_id', authData.user.id)
        .single()

      return res.json({ success: true, data })
    }

    // 📊 STATS
    if (action === "stats") {
      const { institute_code } = req.query

      const { count: totalJobs } = await supabase
        .from('jobs_queue')
        .select('*', { count: 'exact', head: true })
        .eq('institute_code', institute_code)

      const { count: students } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('institute_code', institute_code)

      return res.json({
        success: true,
        data: { totalJobs, students }
      })
    }

    return res.status(400).json({ success: false, error: "Invalid action" })

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}