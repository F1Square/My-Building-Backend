const MONTHS = {
  en: ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  hi: ['', 'जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
  gu: ['', 'જાન્યુઆરી', 'ફેબ્રુઆરી', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટેમ્બર', 'ઑક્ટોબર', 'નવેમ્બર', 'ડિસેમ્બર'],
};

const DATE_LOCALE = { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN' };

const STATUS = {
  en: { open: 'open', in_progress: 'in progress', resolved: 'resolved', closed: 'closed' },
  hi: { open: 'खुला', in_progress: 'प्रगति में', resolved: 'हल हो गया', closed: 'बंद' },
  gu: { open: 'ખુલ્લું', in_progress: 'પ્રગતિમાં', resolved: 'ઉકેલાયું', closed: 'બંધ' },
};

function normalizeLang(lang) {
  if (lang === 'hi' || lang === 'gu') return lang;
  return 'en';
}

function rupees(amount) {
  const n = Number(amount);
  if (Number.isNaN(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN')}`;
}

function preview(text, max = 120) {
  const t = String(text || '').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function createCopy(lang) {
  const L = normalizeLang(lang);
  const months = MONTHS[L];

  const monthYear = (month, year) => {
    const m = months[Number(month)] || '';
    return m && year ? `${m} ${year}` : m || String(year || '');
  };

  const formatDueDate = (dueDate) => {
    if (!dueDate) return L === 'hi' ? 'जल्द' : L === 'gu' ? 'ટૂંક સમયમાં' : 'soon';
    try {
      return new Date(dueDate).toLocaleDateString(DATE_LOCALE[L], {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch {
      return String(dueDate);
    }
  };

  const residentFlatLabel = (user) => {
    if (!user) return '';
    const flat = user.flat_no?.trim();
    const wing = user.wing?.trim();
    if (L === 'hi') {
      if (wing && flat) return `विंग ${wing}, फ्लैट ${flat}`;
      if (flat) return `फ्लैट ${flat}`;
    } else if (L === 'gu') {
      if (wing && flat) return `વિંગ ${wing}, ફ્લેટ ${flat}`;
      if (flat) return `ફ્લેટ ${flat}`;
    } else {
      if (wing && flat) return `Wing ${wing}, Flat ${flat}`;
      if (flat) return `Flat ${flat}`;
    }
    return '';
  };

  const statusLabel = (status) => STATUS[L][status] || String(status || '').replace(/_/g, ' ');

  const formatDateTime = (dateTime) => {
    try {
      return new Date(dateTime).toLocaleString(DATE_LOCALE[L], {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return String(dateTime);
    }
  };

  const t = {
    en: {
      announcementTitle: 'New announcement added',
      announcementUrgentTitle: 'Urgent: New announcement added',
      announcementBody: (title, body, by) => `${title}: ${body} — by ${by}`,
      maintenanceTitle: '🧾 New Maintenance Bill',
      maintenanceBody: (period, amt, due) => `Your ${period} maintenance bill is ${amt}. Due date: ${due}.`,
      maintenancePenalty: (period, amt, due, pen) => `Your ${period} bill is ${amt}. Please pay by ${due} to avoid a ${pen} late fee.`,
      waterUniformTitle: '💧 Water Bill Added',
      waterUniformBody: (amt, due) => `A water bill of ${amt} has been added. Please pay by ${due}.`,
      waterFlatTitle: '💧 Your Water Bill',
      waterFlatBody: (amt, due) => `Your water bill is ${amt}. Please pay by ${due}.`,
      specialUniformTitle: '📋 Special Bill Added',
      specialUniformBody: (desc, amt, due) => `${desc}: ${amt}. Due by ${due}.`,
      specialFlatTitle: '📋 Your Special Bill',
      specialFlatBody: (desc, amt, due) => `${desc} — ${amt}. Please pay by ${due}.`,
      paymentApprovedTitle: '✅ Payment Approved',
      paymentApprovedBody: (method, amt) => `Your ${method} payment of ${amt} is confirmed. You can download the receipt now.`,
      cashRequestTitle: '💵 Cash Payment Request',
      cashRequestBodyPeriod: (amt, period) => `A resident wants to pay ${amt} for ${period} in cash. Collect and approve once received.`,
      cashRequestBody: (amt) => `A resident wants to pay ${amt} in cash. Collect and approve once received.`,
      reminderManualTitle: '⏰ Payment Reminder',
      reminderManualBody: (period, amt) => `Friendly reminder: your ${period} maintenance of ${amt} is still pending. Please pay when you can.`,
      reminderPushTitle: '⏰ Payment Reminder',
      reminderPushBody: 'You have a pending maintenance payment. Open the app to pay now.',
      reminderScheduledTitle: '⏰ Bill Due Tomorrow',
      reminderScheduledDesc: (desc, amt) => `Last day to pay "${desc}" — ${amt}. Please pay today to avoid late fees.`,
      reminderScheduledBody: (amt) => `Last day to pay your bill of ${amt}. Please pay today.`,
      visitorGateTitle: '👋 Visitor at Society Gate',
      visitorGateBody: (name, flat, purpose) => `${name} is visiting ${flat}${purpose}.`,
      visitorDoorTitle: '🚪 Visitor at Your Door',
      visitorDoorBody: (name, at, purpose) => `${name} has arrived${at}${purpose}.`,
      flatWord: 'Flat',
      aFlat: 'a flat',
      forPurpose: (p) => ` for ${p}`,
      atFlat: (f) => ` at ${f}`,
      purposeDash: (p) => ` — ${p}`,
      joinRequestTitle: '🏠 New Join Request',
      joinRequestBody: (name) => `${name} wants to join your society. Please review and approve or reject.`,
      joinApprovedTitle: '✅ Welcome to Your Society!',
      joinApprovedBody: 'Your join request was approved. You can now use all society features in the app.',
      joinRejectedTitle: '❌ Join Request Declined',
      joinRejectedBody: 'Your request to join this society was not approved. Contact your Pramukh for help.',
      pramukhTitle: '⭐ You Are Now Pramukh',
      pramukhBody: 'You have been promoted to Pramukh. You can now manage members, bills, and society settings.',
      demotedTitle: '👤 Role Updated',
      demotedBody: 'Your role has been changed to Member. Contact admin if you have questions.',
      complaintTitle: '📣 New Society Complaint',
      complaintBodyFlat: (name, flat, title) => `${name} (${flat}) raised: ${title}`,
      complaintBody: (name, title) => `${name} raised a complaint: ${title}`,
      complaintStatusTitle: 'Complaint status updated',
      complaintStatusBody: (title, status, by) => `"${title}" is now ${status} — by ${by}`,
      expenseInflowTitle: 'New inflow added',
      expenseOutflowTitle: 'New outflow added',
      expenseBody: (amt, desc, by) => `${amt}: ${desc} — by ${by}`,
      parkingReportTitle: '🚗 Parking Issue Reported',
      parkingReportBodyV: (name, desc, v) => `${name} reported a parking problem${desc} (${v}).`,
      parkingReportBody: (name, desc) => `${name} reported a parking issue${desc}.`,
      parkingReminderTitle: '🚗 Parking Reminder',
      parkingReminderBody: (v) => `Your vehicle ${v} may be blocking others. Please move it when possible.`,
      meetingTitle: '📅 Society Meeting',
      meetingBodyLoc: (title, when, loc) => `${title} on ${when} at ${loc}.`,
      meetingBody: (title, when) => `${title} is scheduled on ${when}.`,
      repairNewTitle: '🔧 New Repair Request',
      repairNewBody: (name, title) => `${name} submitted a request: ${title}`,
      repairUpdateTitle: '🔧 Request Status Updated',
      repairUpdateBody: (title, status) => `Your request "${title}" is now ${status}.`,
      supportNewTitle: '🆘 New Help Request',
      supportNewBody: (name, subject) => `${name} needs help: ${subject}`,
      supportReplyTitle: '💬 Support Team Replied',
      supportReplyBody: (subject) => `You have a new reply on "${subject}". Open Help & Support to read it.`,
      supportUserReplyTitle: '💬 Support Ticket Updated',
      supportUserReplyBody: (name, subject) => `${name} replied on "${subject}".`,
      supportStatusTitle: '📋 Ticket Status Updated',
      supportStatusBody: (subject, status) => `Your request "${subject}" is now ${status}.`,
    },
    hi: {
      announcementTitle: 'नई घोषणा जोड़ी गई',
      announcementUrgentTitle: 'जरूरी: नई घोषणा जोड़ी गई',
      announcementBody: (title, body, by) => `${title}: ${body} — द्वारा ${by}`,
      maintenanceTitle: '🧾 नया रखरखाव बिल',
      maintenanceBody: (period, amt, due) => `आपका ${period} का रखरखाव बिल ${amt} है। अंतिम तिथि: ${due}।`,
      maintenancePenalty: (period, amt, due, pen) => `आपका ${period} का बिल ${amt} है। ${due} तक भुगतान करें, नहीं तो ${pen} विलंब शुल्क लगेगा।`,
      waterUniformTitle: '💧 पानी का बिल जोड़ा गया',
      waterUniformBody: (amt, due) => `पानी का बिल ${amt} जोड़ा गया है। कृपया ${due} तक भुगतान करें।`,
      waterFlatTitle: '💧 आपका पानी बिल',
      waterFlatBody: (amt, due) => `आपका पानी बिल ${amt} है। कृपया ${due} तक भुगतान करें।`,
      specialUniformTitle: '📋 विशेष बिल जोड़ा गया',
      specialUniformBody: (desc, amt, due) => `${desc}: ${amt}। अंतिम तिथि ${due}।`,
      specialFlatTitle: '📋 आपका विशेष बिल',
      specialFlatBody: (desc, amt, due) => `${desc} — ${amt}। कृपया ${due} तक भुगतान करें।`,
      paymentApprovedTitle: '✅ भुगतान स्वीकृत',
      paymentApprovedBody: (method, amt) => `आपका ${method} भुगतान ${amt} पुष्टि हो गया है। अब रसीद डाउनलोड कर सकते हैं।`,
      cashRequestTitle: '💵 नकद भुगतान अनुरोध',
      cashRequestBodyPeriod: (amt, period) => `एक सदस्य ${period} के लिए ${amt} नकद में देना चाहता है। राशि लेकर स्वीकृत करें।`,
      cashRequestBody: (amt) => `एक सदस्य ${amt} नकद में देना चाहता है। राशि लेकर स्वीकृत करें।`,
      reminderManualTitle: '⏰ भुगतान अनुस्मारक',
      reminderManualBody: (period, amt) => `अनुस्मारक: आपका ${period} का ${amt} बकाया है। कृपया जल्द भुगतान करें।`,
      reminderPushTitle: '⏰ भुगतान अनुस्मारक',
      reminderPushBody: 'आपका रखरखाव बकाया है। भुगतान के लिए ऐप खोलें।',
      reminderScheduledTitle: '⏰ कल अंतिम दिन',
      reminderScheduledDesc: (desc, amt) => `"${desc}" का भुगतान कल समाप्त — ${amt}। आज भुगतान करें।`,
      reminderScheduledBody: (amt) => `आपके बिल ${amt} का कल अंतिम दिन है। आज भुगतान करें।`,
      visitorGateTitle: '👋 गेट पर आगंतुक',
      visitorGateBody: (name, flat, purpose) => `${name} ${flat} पर आ रहे हैं${purpose}।`,
      visitorDoorTitle: '🚪 आपके दरवाजे पर आगंतुक',
      visitorDoorBody: (name, at, purpose) => `${name} आ गए हैं${at}${purpose}।`,
      flatWord: 'फ्लैट',
      aFlat: 'एक फ्लैट',
      forPurpose: (p) => ` — ${p}`,
      atFlat: (f) => ` (${f})`,
      purposeDash: (p) => ` — ${p}`,
      joinRequestTitle: '🏠 नया जॉइन अनुरोध',
      joinRequestBody: (name) => `${name} आपकी सोसायटी में शामिल होना चाहते हैं। कृपया स्वीकृत या अस्वीकार करें।`,
      joinApprovedTitle: '✅ सोसायटी में आपका स्वागत है!',
      joinApprovedBody: 'आपका अनुरोध स्वीकृत हो गया। अब सभी सुविधाएं उपलब्ध हैं।',
      joinRejectedTitle: '❌ जॉइन अनुरोध अस्वीकृत',
      joinRejectedBody: 'आपका अनुरोध स्वीकृत नहीं हुआ। प्रमुख से संपर्क करें।',
      pramukhTitle: '⭐ अब आप प्रमुख हैं',
      pramukhBody: 'आपको प्रमुख बनाया गया है। अब सदस्य, बिल और सेटिंग्स प्रबंधित कर सकते हैं।',
      demotedTitle: '👤 भूमिका अपडेट',
      demotedBody: 'आपकी भूमिका सदस्य में बदली गई। प्रश्न हो तो एडमिन से संपर्क करें।',
      complaintTitle: '📣 नई शिकायत',
      complaintBodyFlat: (name, flat, title) => `${name} (${flat}) ने शिकायत दर्ज की: ${title}`,
      complaintBody: (name, title) => `${name} ने शिकायत दर्ज की: ${title}`,
      complaintStatusTitle: 'शिकायत की स्थिति अपडेट',
      complaintStatusBody: (title, status, by) => `"${title}" अब ${status} है — द्वारा ${by}`,
      expenseInflowTitle: 'नई आमदनी जोड़ी गई',
      expenseOutflowTitle: 'नया खर्च जोड़ा गया',
      expenseBody: (amt, desc, by) => `${amt}: ${desc} — द्वारा ${by}`,
      parkingReportTitle: '🚗 पार्किंग समस्या',
      parkingReportBodyV: (name, desc, v) => `${name} ने पार्किंग की समस्या बताई${desc} (${v})।`,
      parkingReportBody: (name, desc) => `${name} ने पार्किंग की समस्या बताई${desc}।`,
      parkingReminderTitle: '🚗 पार्किंग अनुस्मारक',
      parkingReminderBody: (v) => `आपका वाहन ${v} रास्ता रोक सकता है। कृपया हटाएं।`,
      meetingTitle: '📅 सोसायटी बैठक',
      meetingBodyLoc: (title, when, loc) => `${title} — ${when}, स्थान: ${loc}।`,
      meetingBody: (title, when) => `${title} — ${when} को निर्धारित है।`,
      repairNewTitle: '🔧 नई मरम्मत अनुरोध',
      repairNewBody: (name, title) => `${name} ने अनुरोध भेजा: ${title}`,
      repairUpdateTitle: '🔧 अनुरोध स्थिति अपडेट',
      repairUpdateBody: (title, status) => `आपका अनुरोध "${title}" अब ${status} है।`,
      supportNewTitle: '🆘 नई सहायता अनुरोध',
      supportNewBody: (name, subject) => `${name} को मदद चाहिए: ${subject}`,
      supportReplyTitle: '💬 सहायता टीम ने जवाब दिया',
      supportReplyBody: (subject) => `"${subject}" पर नया जवाब है। Help & Support में देखें।`,
      supportUserReplyTitle: '💬 टिकट अपडेट',
      supportUserReplyBody: (name, subject) => `${name} ने "${subject}" पर जवाब दिया।`,
      supportStatusTitle: '📋 टिकट स्थिति अपडेट',
      supportStatusBody: (subject, status) => `आपका अनुरोध "${subject}" अब ${status} है।`,
    },
    gu: {
      announcementTitle: 'નવી જાહેરાત ઉમેરાઈ',
      announcementUrgentTitle: 'તાત્કાલિક: નવી જાહેરાત ઉમેરાઈ',
      announcementBody: (title, body, by) => `${title}: ${body} — દ્વારા ${by}`,
      maintenanceTitle: '🧾 નવું જાળવણી બિલ',
      maintenanceBody: (period, amt, due) => `તમારું ${period} જાળવણી બિલ ${amt} છે. અંતિમ તારીખ: ${due}.`,
      maintenancePenalty: (period, amt, due, pen) => `તમારું ${period} બિલ ${amt} છે. ${due} સુધી ચૂકવો, નહીંતર ${pen} વિલંબ શુલ્ક.`,
      waterUniformTitle: '💧 પાણી બિલ ઉમેરાયું',
      waterUniformBody: (amt, due) => `પાણી બિલ ${amt} ઉમેરાયું છે. ${due} સુધી ચૂકવો.`,
      waterFlatTitle: '💧 તમારું પાણી બિલ',
      waterFlatBody: (amt, due) => `તમારું પાણી બિલ ${amt} છે. ${due} સુધી ચૂકવો.`,
      specialUniformTitle: '📋 વિશેષ બિલ ઉમેરાયું',
      specialUniformBody: (desc, amt, due) => `${desc}: ${amt}. અંતિમ તારીખ ${due}.`,
      specialFlatTitle: '📋 તમારું વિશેષ બિલ',
      specialFlatBody: (desc, amt, due) => `${desc} — ${amt}. ${due} સુધી ચૂકવો.`,
      paymentApprovedTitle: '✅ ચૂકવણી મંજૂર',
      paymentApprovedBody: (method, amt) => `તમારી ${method} ચૂકવણી ${amt} પુષ્ટિ થઈ. હવે રસીદ ડાઉનલોડ કરી શકો.`,
      cashRequestTitle: '💵 રોકડ ચૂકવણી વિનંતી',
      cashRequestBodyPeriod: (amt, period) => `સભ્ય ${period} માટે ${amt} રોકડમાં ચૂકવવા માંગે છે. રકમ લઈ મંજૂર કરો.`,
      cashRequestBody: (amt) => `સભ્ય ${amt} રોકડમાં ચૂકવવા માંગે છે. રકમ લઈ મંજૂર કરો.`,
      reminderManualTitle: '⏰ ચૂકવણી યાદ અપાવો',
      reminderManualBody: (period, amt) => `યાદ અપાવો: તમારું ${period} નું ${amt} બાકી છે. ટૂંક સમયમાં ચૂકવો.`,
      reminderPushTitle: '⏰ ચૂકવણી યાદ અપાવો',
      reminderPushBody: 'જાળવણી બાકી છે. ચૂકવણી માટે એપ ખોલો.',
      reminderScheduledTitle: '⏰ કાલે અંતિમ દિવસ',
      reminderScheduledDesc: (desc, amt) => `"${desc}" ચૂકવણી કાલે સમાપ્ત — ${amt}. આજે ચૂકવો.`,
      reminderScheduledBody: (amt) => `તમારા બિલ ${amt} નો કાલે અંતિમ દિવસ છે. આજે ચૂકવો.`,
      visitorGateTitle: '👋 ગેટ પર મુલાકાતી',
      visitorGateBody: (name, flat, purpose) => `${name} ${flat} માં આવી રહ્યા છે${purpose}.`,
      visitorDoorTitle: '🚪 તમારા દરવાજે મુલાકાતી',
      visitorDoorBody: (name, at, purpose) => `${name} આવી ગયા${at}${purpose}.`,
      flatWord: 'ફ્લેટ',
      aFlat: 'એક ફ્લેટ',
      forPurpose: (p) => ` — ${p}`,
      atFlat: (f) => ` (${f})`,
      purposeDash: (p) => ` — ${p}`,
      joinRequestTitle: '🏠 નવી જોડાવાની વિનંતી',
      joinRequestBody: (name) => `${name} તમારી સોસાયટીમાં જોડાવા માંગે છે. મંજૂર અથવા નકારી કરો.`,
      joinApprovedTitle: '✅ સોસાયટીમાં સ્વાગત છે!',
      joinApprovedBody: 'તમારી વિનંતી મંજૂર થઈ. હવે બધી સુવિધાઓ ઉપલબ્ધ છે.',
      joinRejectedTitle: '❌ વિનંતી નકારી',
      joinRejectedBody: 'તમારી વિનંતી મંજૂર ન થઈ. પ્રમુખનો સંપર્ક કરો.',
      pramukhTitle: '⭐ હવે તમે પ્રમુખ છો',
      pramukhBody: 'તમને પ્રમુખ બનાવવામાં આવ્યા. સભ્યો, બિલ અને સેટિંગ્સ મેનેજ કરી શકો.',
      demotedTitle: '👤 ભૂમિકા અપડેટ',
      demotedBody: 'તમારી ભૂમિકા સભ્યમાં બદલાઈ. પ્રશ્ન હોય તો એડમિનનો સંપર્ક કરો.',
      complaintTitle: '📣 નવી ફરિયાદ',
      complaintBodyFlat: (name, flat, title) => `${name} (${flat}) એ ફરિયાદ નોંધાવી: ${title}`,
      complaintBody: (name, title) => `${name} એ ફરિયાદ નોંધાવી: ${title}`,
      complaintStatusTitle: 'ફરિયાદ સ્થિતિ અપડેટ',
      complaintStatusBody: (title, status, by) => `"${title}" હવે ${status} છે — દ્વારા ${by}`,
      expenseInflowTitle: 'નવી આવક ઉમેરાઈ',
      expenseOutflowTitle: 'નવો ખર્ચ ઉમેરાયો',
      expenseBody: (amt, desc, by) => `${amt}: ${desc} — દ્વારા ${by}`,
      parkingReportTitle: '🚗 પાર્કિંગ સમસ્યા',
      parkingReportBodyV: (name, desc, v) => `${name} એ પાર્કિંગ સમસ્યા જણાવી${desc} (${v}).`,
      parkingReportBody: (name, desc) => `${name} એ પાર્કિંગ સમસ્યા જણાવી${desc}.`,
      parkingReminderTitle: '🚗 પાર્કિંગ યાદ અપાવો',
      parkingReminderBody: (v) => `તમારું વાહન ${v} અવરોધ કરી શકે. કૃપા કરી હટાવો.`,
      meetingTitle: '📅 સોસાયટી મીટિંગ',
      meetingBodyLoc: (title, when, loc) => `${title} — ${when}, સ્થળ: ${loc}.`,
      meetingBody: (title, when) => `${title} — ${when} ના રોજ નક્કી.`,
      repairNewTitle: '🔧 નવી મરામત વિનંતી',
      repairNewBody: (name, title) => `${name} એ વિનંતી મોકલી: ${title}`,
      repairUpdateTitle: '🔧 વિનંતી સ્થિતિ અપડેટ',
      repairUpdateBody: (title, status) => `તમારી વિનંતી "${title}" હવે ${status} છે.`,
      supportNewTitle: '🆘 નવી મદદ વિનંતી',
      supportNewBody: (name, subject) => `${name} ને મદદ જોઈએ: ${subject}`,
      supportReplyTitle: '💬 સપોર્ટ ટીમે જવાબ આપ્યો',
      supportReplyBody: (subject) => `"${subject}" પર નવો જવાબ છે. Help & Support માં જુઓ.`,
      supportUserReplyTitle: '💬 ટિકિટ અપડેટ',
      supportUserReplyBody: (name, subject) => `${name} એ "${subject}" પર જવાબ આપ્યો.`,
      supportStatusTitle: '📋 ટિકિટ સ્થિતિ અપડેટ',
      supportStatusBody: (subject, status) => `તમારી વિનંતી "${subject}" હવે ${status} છે.`,
    },
  }[L];

  return {
    monthYear,
    formatDueDate,
    residentFlatLabel,
    statusLabel,
    preview,
    rupees,

    announcement: (title, body, urgent, byName) => ({
      title: urgent ? t.announcementUrgentTitle : t.announcementTitle,
      body: t.announcementBody(title, preview(body), byName || 'Pramukh'),
    }),

    maintenanceBill: (amount, month, year, dueDate, penalty) => {
      const period = monthYear(month, year);
      const due = formatDueDate(dueDate);
      const amt = rupees(amount);
      return {
        title: t.maintenanceTitle,
        body: penalty > 0
          ? t.maintenancePenalty(period, amt, due, rupees(penalty))
          : t.maintenanceBody(period, amt, due),
      };
    },

    waterBillUniform: (amount, dueDate) => ({
      title: t.waterUniformTitle,
      body: t.waterUniformBody(rupees(amount), formatDueDate(dueDate)),
    }),

    waterBillFlat: (amount, dueDate) => ({
      title: t.waterFlatTitle,
      body: t.waterFlatBody(rupees(amount), formatDueDate(dueDate)),
    }),

    specialBillUniform: (description, amount, dueDate) => ({
      title: t.specialUniformTitle,
      body: t.specialUniformBody(description, rupees(amount), formatDueDate(dueDate)),
    }),

    specialBillFlat: (description, amount, dueDate) => ({
      title: t.specialFlatTitle,
      body: t.specialFlatBody(description, rupees(amount), formatDueDate(dueDate)),
    }),

    paymentApproved: (method, amount) => ({
      title: t.paymentApprovedTitle,
      body: t.paymentApprovedBody(method, rupees(amount)),
    }),

    cashPaymentRequested: (amount, period) => ({
      title: t.cashRequestTitle,
      body: period
        ? t.cashRequestBodyPeriod(rupees(amount), period)
        : t.cashRequestBody(rupees(amount)),
    }),

    paymentReminderManual: (amount, month, year) => ({
      title: t.reminderManualTitle,
      body: t.reminderManualBody(monthYear(month, year), rupees(amount)),
    }),

    paymentReminderPush: () => ({
      title: t.reminderPushTitle,
      body: t.reminderPushBody,
    }),

    paymentReminderScheduled: (description, amount) => ({
      title: t.reminderScheduledTitle,
      body: description
        ? t.reminderScheduledDesc(description, rupees(amount))
        : t.reminderScheduledBody(rupees(amount)),
    }),

    visitorWatchman: (name, flatNo, purpose) => {
      const flat = flatNo ? `${t.flatWord} ${flatNo}` : t.aFlat;
      const purp = purpose ? t.forPurpose(purpose) : '';
      return { title: t.visitorGateTitle, body: t.visitorGateBody(name, flat, purp) };
    },

    visitorAtDoor: (name, flatNo, purpose) => {
      const at = flatNo ? t.atFlat(flatNo) : '';
      const purp = purpose ? t.purposeDash(purpose) : '';
      return { title: t.visitorDoorTitle, body: t.visitorDoorBody(name, at, purp) };
    },

    joinRequest: (requesterName) => ({
      title: t.joinRequestTitle,
      body: t.joinRequestBody(requesterName),
    }),

    joinApproved: () => ({
      title: t.joinApprovedTitle,
      body: t.joinApprovedBody,
    }),

    joinRejected: () => ({
      title: t.joinRejectedTitle,
      body: t.joinRejectedBody,
    }),

    promotedPramukh: () => ({
      title: t.pramukhTitle,
      body: t.pramukhBody,
    }),

    demotedToUser: () => ({
      title: t.demotedTitle,
      body: t.demotedBody,
    }),

    complaintNew: (residentName, flatLabel, complaintTitle) => ({
      title: t.complaintTitle,
      body: flatLabel
        ? t.complaintBodyFlat(residentName, flatLabel, complaintTitle)
        : t.complaintBody(residentName, complaintTitle),
    }),

    complaintStatusUpdate: (complaintTitle, status, byName) => ({
      title: t.complaintStatusTitle,
      body: t.complaintStatusBody(complaintTitle, statusLabel(status), byName || 'Pramukh'),
    }),

    expenseEntry: (type, amount, description, byName) => ({
      title: type === 'inflow' ? t.expenseInflowTitle : t.expenseOutflowTitle,
      body: t.expenseBody(rupees(amount), preview(description, 80), byName || 'Pramukh'),
    }),

    parkingReport: (reporterName, description, vehicleNumber) => {
      const desc = description ? `: ${description}` : '';
      return vehicleNumber
        ? {
          title: t.parkingReportTitle,
          body: t.parkingReportBodyV(reporterName, desc, vehicleNumber.toUpperCase()),
        }
        : {
          title: t.parkingReportTitle,
          body: t.parkingReportBody(reporterName, desc),
        };
    },

    parkingReminder: (vehicleNumber, customMessage) => ({
      title: t.parkingReminderTitle,
      body: customMessage || t.parkingReminderBody(vehicleNumber.toUpperCase()),
    }),

    meetingScheduled: (title, dateTime, location) => {
      const when = formatDateTime(dateTime);
      return location
        ? { title: t.meetingTitle, body: t.meetingBodyLoc(title, when, location) }
        : { title: t.meetingTitle, body: t.meetingBody(title, when) };
    },

    maintenanceRequestNew: (name, title) => ({
      title: t.repairNewTitle,
      body: t.repairNewBody(name, title),
    }),

    maintenanceRequestUpdate: (title, status) => ({
      title: t.repairUpdateTitle,
      body: t.repairUpdateBody(title, statusLabel(status)),
    }),

    supportTicketNew: (userName, subject) => ({
      title: t.supportNewTitle,
      body: t.supportNewBody(userName, subject),
    }),

    supportReply: (subject) => ({
      title: t.supportReplyTitle,
      body: t.supportReplyBody(subject),
    }),

    supportUserReply: (userName, subject) => ({
      title: t.supportUserReplyTitle,
      body: t.supportUserReplyBody(userName, subject),
    }),

    supportStatus: (subject, status) => ({
      title: t.supportStatusTitle,
      body: t.supportStatusBody(subject, statusLabel(status)),
    }),
  };
}

module.exports = {
  normalizeLang,
  createCopy,
  MONTHS,
  // English defaults for helpers used outside notifications
  ...createCopy('en'),
};
