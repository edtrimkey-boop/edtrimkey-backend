import { supabase } from '../lib/supabase.js'

export default async function handler(req, res) {
  const { action } = req.query

  try {

    // 🔐 LOGIN
    if (action === "login") {
      const { email, password } = req.body

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) throw error

      const { data: user } = await supabase
        .from('users')
        .select('id, full_name, role, institute_code')
        .eq('auth_user_id', data.user.id)
        .single()

      return res.json({
        success: true,
        data: {
          user,
          session: data.session
        }
      })
    }

    return res.status(400).json({ success: false, error: "Invalid action" })

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
}