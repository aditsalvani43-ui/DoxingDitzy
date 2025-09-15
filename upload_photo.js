require('dotenv').config();
const formidable = require('formidable');
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req,res)=>{
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files)=>{
    try{
      if(err) return res.status(400).json({error:'Invalid form data'});
      const metadata = fields.metadata ? JSON.parse(fields.metadata) : { consent:false };
      if(!metadata.consent) return res.status(403).json({error:'Missing user consent'});

      const photo = files.photo;
      if(!photo||!photo.path) return res.status(400).json({error:'No photo file'});

      const buffer = fs.readFileSync(photo.path);

      // Telegram
      let tgJson = null;
      if(metadata.notifyAdmin && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID){
        const formData = new FormData();
        formData.append('chat_id', process.env.TELEGRAM_CHAT_ID);
        const caption = [
          'Photo upload (consent=true)',
          `Time: ${metadata.timestamp||'N/A'}`,
          `UA: ${metadata.userAgent?.substring(0,120)||'N/A'}`,
          `Screen: ${metadata.screen||'N/A'}`
        ].join('\n');
        formData.append('photo', buffer, {filename:'capture.jpg', contentType:'image/jpeg'});
        formData.append('caption', caption);

        const tgResp = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto`,{
          method:'POST', body:formData
        });
        tgJson = await tgResp.json();
        if(!tgJson.ok) console.error('telegram error', tgJson);
      }

      // Supabase log
      try{
        await supabase.from('photos').insert([
          {
            timestamp: metadata.timestamp||new Date().toISOString(),
            user_agent: metadata.userAgent||null,
            screen: metadata.screen||null,
            notify_admin: metadata.notifyAdmin||false
          }
        ]);
      }catch(e){ console.error('supabase insert error', e); }

      try{ fs.unlinkSync(photo.path); }catch(e){}

      return res.json({ok:true, forwarded:!!tgJson, telegram:tgJson});
    }catch(e){
      console.error('upload handler error', e);
      return res.status(500).json({error:String(e)});
    }
  });
};
