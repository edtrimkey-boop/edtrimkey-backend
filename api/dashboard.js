import { supabase } from '../lib/supabase.js'

export default async function handler(req, res) {
  const { action } = req.query

  try {

    // PROFILE
    if (action === "profile") {
      const token = req.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        return res.status(401).json({ success: false, error: "No token" })
      }

      const { data: authData, error: authError } = await supabase.auth.getUser(token)

      if (authError) throw authError

      const { data, error } = await supabase
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

      if (error) throw error

      return res.status(200).json({ success: true, data })
    }

    // STATS
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

      return res.status(200).json({
        success: true,
        data: { totalJobs, students }
      })
    }

    return res.status(400).json({ success: false, error: "Invalid action" })

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}