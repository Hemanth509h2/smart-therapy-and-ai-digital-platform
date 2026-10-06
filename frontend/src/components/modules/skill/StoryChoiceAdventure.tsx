'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { doc, onSnapshot, updateDoc, arrayUnion, increment } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedScene } from './shared/animationVerbs'
import type { SceneMeta } from './shared/sceneTypes'

interface StoryChoiceAdventureProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Level = 'easy' | 'moderate' | 'advanced'
type Lang = 'en' | 'hi' | 'both'
type Quality = 'best' | 'okay' | 'poor'

type Choice = {
  label: 'A' | 'B' | 'C'
  icon: string
  en: string
  hi: string
  quality: Quality
  consequence_en: string
  consequence_hi: string
}

type Scenario = {
  id: string
  level: Level
  en: string
  hi: string
  choices: [Choice, Choice, Choice]
}

const SCENARIOS: Scenario[] = [
  {
    id: 'easy_1',
    level: 'easy',
    en: 'Your friend forgot your birthday.',
    hi: 'तुम्हारा दोस्त तुम्हारा जन्मदिन भूल गया।',
    choices: [
      {
        label: 'A', icon: '💬', quality: 'best',
        en: 'I will calmly ask if they forgot.',
        hi: 'मैं उससे प्यार से पूछूँगा कि क्या वह भूल गया था।',
        consequence_en: 'Your friend apologises and you both feel better.',
        consequence_hi: 'तुम्हारा दोस्त माफ़ी माँगता है और तुम दोनों अच्छा महसूस करते हो।',
      },
      {
        label: 'B', icon: '🤐', quality: 'okay',
        en: 'I will say nothing.',
        hi: 'मैं कुछ नहीं बोलूँगा।',
        consequence_en: 'You feel sad inside but the friendship stays okay.',
        consequence_hi: 'तुम अंदर से दुखी रहते हो पर दोस्ती ठीक रहती है।',
      },
      {
        label: 'C', icon: '😠', quality: 'poor',
        en: 'I will fight with them and stop talking.',
        hi: 'मैं उससे लड़ाई करूँगा और बात नहीं करूँगा।',
        consequence_en: 'Your friend feels hurt and you both feel sad.',
        consequence_hi: 'तुम्हारे दोस्त को बुरा लगता है और तुम दोनों दुखी हो जाते हो।',
      },
    ],
  },
  {
    id: 'easy_2',
    level: 'easy',
    en: 'A classmate asks if they can borrow your crayons.',
    hi: 'तुम्हारी क्लास का एक बच्चा तुमसे रंग वाली पेंसिल माँगता है।',
    choices: [
      {
        label: 'A', icon: '🖍️', quality: 'best',
        en: 'I will share my crayons happily.',
        hi: 'मैं खुशी से अपने रंग दे दूँगा।',
        consequence_en: 'Your classmate smiles and says thank you.',
        consequence_hi: 'तुम्हारा साथी मुस्कुराकर धन्यवाद बोलता है।',
      },
      {
        label: 'B', icon: '⏳', quality: 'okay',
        en: 'I will say I need them right now but can share later.',
        hi: 'मैं कहूँगा अभी मुझे चाहिए, बाद में दे सकता हूँ।',
        consequence_en: 'They wait and you share when you are done.',
        consequence_hi: 'वह इंतज़ार करता है और तुम खत्म होने पर दे देते हो।',
      },
      {
        label: 'C', icon: '🙅', quality: 'poor',
        en: 'I will say no and ignore them.',
        hi: 'मैं मना कर दूँगा और ध्यान नहीं दूँगा।',
        consequence_en: 'Your classmate feels sad and left out.',
        consequence_hi: 'तुम्हारा साथी दुखी और अकेला महसूस करता है।',
      },
    ],
  },
  {
    id: 'easy_3',
    level: 'easy',
    en: 'You accidentally spilled water in the classroom.',
    hi: 'तुमसे गलती से क्लास में पानी गिर गया।',
    choices: [
      {
        label: 'A', icon: '🧽', quality: 'best',
        en: 'I will tell the teacher and help clean it up.',
        hi: 'मैं टीचर को बताऊँगा और सफ़ाई में मदद करूँगा।',
        consequence_en: 'The teacher is happy you were honest and responsible.',
        consequence_hi: 'टीचर खुश होती है कि तुम ईमानदार और ज़िम्मेदार हो।',
      },
      {
        label: 'B', icon: '🤫', quality: 'okay',
        en: 'I will quietly clean it myself.',
        hi: 'मैं चुपचाप खुद साफ़ कर लूँगा।',
        consequence_en: 'The mess is cleaned and nobody is upset.',
        consequence_hi: 'गंदगी साफ़ हो जाती है और कोई परेशान नहीं होता।',
      },
      {
        label: 'C', icon: '🚶', quality: 'poor',
        en: 'I will pretend it was not me and walk away.',
        hi: 'मैं ऐसे करूँगा जैसे मैंने नहीं गिराया और चला जाऊँगा।',
        consequence_en: 'Another child slips on the water and gets hurt.',
        consequence_hi: 'दूसरा बच्चा पानी में फिसल जाता है और चोट लग जाती है।',
      },
    ],
  },
  {
    id: 'easy_4',
    level: 'easy',
    en: 'Your younger sibling wants to play with your favourite toy.',
    hi: 'तुम्हारा छोटा भाई या बहन तुम्हारा पसंदीदा खिलौना माँग रहा है।',
    choices: [
      {
        label: 'A', icon: '🤝', quality: 'best',
        en: 'I will share for a little while and take turns.',
        hi: 'मैं थोड़ी देर के लिए दे दूँगा और बारी-बारी से खेलेंगे।',
        consequence_en: 'You both play happily and have a great time.',
        consequence_hi: 'तुम दोनों खुशी से खेलते हो और बहुत मज़ा आता है।',
      },
      {
        label: 'B', icon: '🧸', quality: 'okay',
        en: 'I will give a different toy instead.',
        hi: 'मैं उसे कोई दूसरा खिलौना दे दूँगा।',
        consequence_en: 'They are a little disappointed but still play.',
        consequence_hi: 'वह थोड़ा निराश होता है पर फिर भी खेलता है।',
      },
      {
        label: 'C', icon: '😤', quality: 'poor',
        en: 'I will snatch it back and tell them to go away.',
        hi: 'मैं वापस छीन लूँगा और कहूँगा कि जाओ यहाँ से।',
        consequence_en: 'Your sibling cries and feels very sad.',
        consequence_hi: 'तुम्हारे भाई या बहन को रोना आ जाता है और बहुत बुरा लगता है।',
      },
    ],
  },
  {
    id: 'easy_5',
    level: 'easy',
    en: 'Some children ask you to join their game.',
    hi: 'कुछ बच्चे तुम्हें अपने साथ खेलने के लिए बुलाते हैं।',
    choices: [
      {
        label: 'A', icon: '🎉', quality: 'best',
        en: 'I will join them and play happily together.',
        hi: 'मैं उनके साथ खुशी से शामिल हो जाऊँगा।',
        consequence_en: 'You make new friends and have lots of fun.',
        consequence_hi: 'तुम नए दोस्त बनाते हो और बहुत मज़ा आता है।',
      },
      {
        label: 'B', icon: '👀', quality: 'okay',
        en: 'I will watch for a while before joining.',
        hi: 'मैं पहले थोड़ा देखूँगा फिर शामिल हो जाऊँगा।',
        consequence_en: 'You join a bit late but still enjoy the game.',
        consequence_hi: 'तुम थोड़ी देर बाद शामिल होते हो पर फिर भी मज़ा आता है।',
      },
      {
        label: 'C', icon: '🪑', quality: 'poor',
        en: 'I will ignore them and sit alone.',
        hi: 'मैं उन्हें नज़रअंदाज़ करूँगा और अकेले बैठूँगा।',
        consequence_en: 'You feel lonely and miss out on making friends.',
        consequence_hi: 'तुम अकेले महसूस करते हो और दोस्त बनाने का मौका चूक जाते हो।',
      },
    ],
  },
  {
    id: 'easy_6',
    level: 'easy',
    en: 'You found a pencil lying on the classroom floor.',
    hi: 'तुम्हें क्लास में एक पेंसिल पड़ी हुई मिली।',
    choices: [
      {
        label: 'A', icon: '🙋', quality: 'best',
        en: 'I will give it to the teacher so the owner can get it back.',
        hi: 'मैं टीचर को दे दूँगा ताकि जिसकी है उसे वापस मिल सके।',
        consequence_en: 'The owner is very happy to get their pencil back.',
        consequence_hi: 'जिसकी पेंसिल है वह बहुत खुश होता है।',
      },
      {
        label: 'B', icon: '❓', quality: 'okay',
        en: 'I will ask my friends who lost their pencil.',
        hi: 'मैं दोस्तों से पूछूँगा किसकी पेंसिल खो गई है।',
        consequence_en: 'You find the owner after asking around.',
        consequence_hi: 'पूछने पर तुम्हें मालिक मिल जाता है।',
      },
      {
        label: 'C', icon: '🎒', quality: 'poor',
        en: 'I will keep it for myself.',
        hi: 'मैं अपने पास रख लूँगा।',
        consequence_en: 'Someone is sad all day because their pencil is missing.',
        consequence_hi: 'कोई बच्चा पूरे दिन दुखी रहता है क्योंकि उसकी पेंसिल नहीं मिली।',
      },
    ],
  },
  {
    id: 'easy_7',
    level: 'easy',
    en: 'Your friend fell down while playing.',
    hi: 'खेलते समय तुम्हारा दोस्त गिर गया।',
    choices: [
      {
        label: 'A', icon: '🏃', quality: 'best',
        en: 'I will run to help them and ask if they are okay.',
        hi: 'मैं दौड़कर उनके पास जाऊँगा और पूछूँगा कि ठीक हो?',
        consequence_en: 'Your friend feels cared for and thanks you.',
        consequence_hi: 'तुम्हारे दोस्त को अच्छा लगता है और वह तुम्हें धन्यवाद देता है।',
      },
      {
        label: 'B', icon: '👩‍🏫', quality: 'okay',
        en: 'I will tell a teacher to come and help.',
        hi: 'मैं टीचर को बुलाने जाऊँगा।',
        consequence_en: 'The teacher helps your friend get up safely.',
        consequence_hi: 'टीचर तुम्हारे दोस्त को उठने में मदद करती है।',
      },
      {
        label: 'C', icon: '😂', quality: 'poor',
        en: 'I will laugh and keep playing.',
        hi: 'मैं हँसूँगा और खेलता रहूँगा।',
        consequence_en: 'Your friend feels embarrassed and hurt.',
        consequence_hi: 'तुम्हारे दोस्त को शर्म और दर्द दोनों होते हैं।',
      },
    ],
  },
  {
    id: 'easy_8',
    level: 'easy',
    en: 'Someone gave you a small surprise gift.',
    hi: 'किसी ने तुम्हें एक छोटा-सा सरप्राइज़ गिफ्ट दिया।',
    choices: [
      {
        label: 'A', icon: '🎁', quality: 'best',
        en: 'I will say thank you and show I am happy.',
        hi: 'मैं धन्यवाद कहूँगा और खुशी ज़ाहिर करूँगा।',
        consequence_en: 'The person feels good that you appreciated their gift.',
        consequence_hi: 'देने वाले को अच्छा लगता है कि तुमने उनके गिफ्ट की कद्र की।',
      },
      {
        label: 'B', icon: '🙂', quality: 'okay',
        en: 'I will smile and say thank you quietly.',
        hi: 'मैं मुस्कुराऊँगा और धीरे से धन्यवाद बोलूँगा।',
        consequence_en: 'The person knows you liked the gift.',
        consequence_hi: 'देने वाले को पता चलता है कि तुम्हें गिफ्ट अच्छा लगा।',
      },
      {
        label: 'C', icon: '😒', quality: 'poor',
        en: 'I will say I wanted something else.',
        hi: 'मैं बोलूँगा कि मुझे कुछ और चाहिए था।',
        consequence_en: 'The person feels sad that their gift was not appreciated.',
        consequence_hi: 'देने वाले को दुख होता है कि उनके गिफ्ट की कद्र नहीं हुई।',
      },
    ],
  },
  {
    id: 'easy_9',
    level: 'easy',
    en: "You came first in today's class quiz.",
    hi: 'आज की क्लास क्विज़ में तुम पहले नंबर पर आए।',
    choices: [
      {
        label: 'A', icon: '🌟', quality: 'best',
        en: 'I will be happy and also encourage my friends who tried hard.',
        hi: 'मैं खुश होऊँगा और मेहनत करने वाले दोस्तों की भी हिम्मत बढ़ाऊँगा।',
        consequence_en: 'Everyone feels good and your friends are inspired.',
        consequence_hi: 'सबको अच्छा लगता है और दोस्तों को प्रेरणा मिलती है।',
      },
      {
        label: 'B', icon: '😊', quality: 'okay',
        en: 'I will feel happy and keep it to myself.',
        hi: 'मैं खुश होऊँगा और मन में ही रखूँगा।',
        consequence_en: 'You feel good but miss a chance to inspire others.',
        consequence_hi: 'तुम्हें अच्छा लगता है पर दूसरों को प्रेरित करने का मौका चूक जाता है।',
      },
      {
        label: 'C', icon: '📢', quality: 'poor',
        en: 'I will boast loudly in front of everyone.',
        hi: 'मैं सबके सामने ज़ोर-ज़ोर से शेखी बघारूँगा।',
        consequence_en: 'Your friends feel bad and some become upset with you.',
        consequence_hi: 'दोस्तों को बुरा लगता है और कुछ तुमसे नाराज़ हो जाते हैं।',
      },
    ],
  },
  {
    id: 'easy_10',
    level: 'easy',
    en: 'Your friend thanked you for helping them.',
    hi: 'तुम्हारे दोस्त ने मदद करने के लिए तुम्हें धन्यवाद कहा।',
    choices: [
      {
        label: 'A', icon: '😄', quality: 'best',
        en: 'I will smile and say I am always happy to help.',
        hi: 'मैं मुस्कुराऊँगा और कहूँगा कि मदद करके मुझे भी अच्छा लगा।',
        consequence_en: 'Your friendship becomes even stronger.',
        consequence_hi: 'तुम्हारी दोस्ती और मज़बूत हो जाती है।',
      },
      {
        label: 'B', icon: '👌', quality: 'okay',
        en: 'I will say it was nothing, no problem.',
        hi: 'मैं कहूँगा कोई बात नहीं, छोटी सी बात है।',
        consequence_en: 'Your friend still feels grateful to you.',
        consequence_hi: 'तुम्हारा दोस्त फिर भी तुम्हारा आभारी है।',
      },
      {
        label: 'C', icon: '🔁', quality: 'poor',
        en: 'I will say they should help me next time too.',
        hi: 'मैं कहूँगा कि अगली बार तुम भी मेरी मदद करना।',
        consequence_en: 'Your friend feels the help came with conditions.',
        consequence_hi: 'दोस्त को लगता है कि मदद में शर्त थी।',
      },
    ],
  },
  {
    id: 'mod_11',
    level: 'moderate',
    en: 'Your friend asks to copy your homework.',
    hi: "तुम्हारा दोस्त कहता है, 'मुझे अपना होमवर्क कॉपी करने दो।'",
    choices: [
      {
        label: 'A', icon: '📚', quality: 'best',
        en: 'I will offer to explain it so they understand and do it themselves.',
        hi: 'मैं उसे समझाऊँगा ताकि वह खुद कर सके।',
        consequence_en: 'Your friend learns and feels proud of their own work.',
        consequence_hi: 'दोस्त सीखता है और खुद के काम पर गर्व महसूस करता है।',
      },
      {
        label: 'B', icon: '🪑', quality: 'okay',
        en: 'I will say I cannot share but will sit with them while they try.',
        hi: 'मैं कहूँगा कि नहीं दे सकता पर साथ बैठकर करवाने में मदद करूँगा।',
        consequence_en: 'Your friend tries and does it with your support.',
        consequence_hi: 'दोस्त कोशिश करता है और तुम्हारे सहयोग से कर लेता है।',
      },
      {
        label: 'C', icon: '📄', quality: 'poor',
        en: 'I will hand over my homework without thinking twice.',
        hi: 'मैं बिना सोचे अपना होमवर्क दे दूँगा।',
        consequence_en: 'Both of you get in trouble when the teacher notices.',
        consequence_hi: 'जब टीचर को पता चलता है तो तुम दोनों मुसीबत में पड़ जाते हो।',
      },
    ],
  },
  {
    id: 'mod_12',
    level: 'moderate',
    en: 'Some children laugh because you gave a wrong answer.',
    hi: 'तुम्हारा जवाब गलत होने पर कुछ बच्चे हँसने लगे।',
    choices: [
      {
        label: 'A', icon: '🌬️', quality: 'best',
        en: 'I will take a deep breath and try again confidently.',
        hi: 'मैं गहरी साँस लूँगा और आत्मविश्वास से दोबारा कोशिश करूँगा।',
        consequence_en: 'The teacher praises your courage to try again.',
        consequence_hi: 'टीचर तुम्हारी दोबारा कोशिश करने की हिम्मत की तारीफ़ करती है।',
      },
      {
        label: 'B', icon: '👂', quality: 'okay',
        en: 'I will stay quiet and listen to the correct answer.',
        hi: 'मैं चुप रहूँगा और सही जवाब सुनूँगा।',
        consequence_en: 'You learn the right answer calmly.',
        consequence_hi: 'तुम शांति से सही जवाब सीख लेते हो।',
      },
      {
        label: 'C', icon: '😡', quality: 'poor',
        en: 'I will shout at the children who laughed at me.',
        hi: 'मैं हँसने वाले बच्चों पर चिल्लाऊँगा।',
        consequence_en: 'The class becomes noisy and the teacher is unhappy.',
        consequence_hi: 'क्लास में शोर हो जाता है और टीचर नाखुश होती है।',
      },
    ],
  },
  {
    id: 'mod_13',
    level: 'moderate',
    en: 'You lost an important competition.',
    hi: 'तुम एक ज़रूरी प्रतियोगिता हार गए।',
    choices: [
      {
        label: 'A', icon: '🤝', quality: 'best',
        en: 'I will congratulate the winner and decide to practise more.',
        hi: 'मैं जीतने वाले को बधाई दूँगा और और मेहनत करने का फैसला करूँगा।',
        consequence_en: 'Everyone respects your sportsmanship.',
        consequence_hi: 'सब तुम्हारे खेल भावना की इज़्ज़त करते हैं।',
      },
      {
        label: 'B', icon: '🚶', quality: 'okay',
        en: 'I will walk away quietly and try to feel better.',
        hi: 'मैं चुपचाप चला जाऊँगा और खुद को ठीक महसूस कराने की कोशिश करूँगा।',
        consequence_en: 'You take time to recover and that is okay.',
        consequence_hi: 'तुम समय लेते हो और यह ठीक है।',
      },
      {
        label: 'C', icon: '🙄', quality: 'poor',
        en: 'I will say the competition was unfair and make excuses.',
        hi: 'मैं कहूँगा कि मुकाबला गलत था और बहाने बनाऊँगा।',
        consequence_en: 'Others feel you cannot accept losing gracefully.',
        consequence_hi: 'दूसरों को लगता है कि तुम हार मानना नहीं जानते।',
      },
    ],
  },
  {
    id: 'mod_14',
    level: 'moderate',
    en: 'The teacher praised another student instead of you.',
    hi: 'टीचर ने तुम्हारी जगह किसी और बच्चे की तारीफ़ की।',
    choices: [
      {
        label: 'A', icon: '👏', quality: 'best',
        en: 'I will feel happy for them and think about how I can improve.',
        hi: 'मैं उनके लिए खुश होऊँगा और सोचूँगा कि मैं कैसे बेहतर बन सकता हूँ।',
        consequence_en: 'You stay positive and your work improves next time.',
        consequence_hi: 'तुम सकारात्मक रहते हो और अगली बार तुम्हारा काम बेहतर होता है।',
      },
      {
        label: 'B', icon: '💪', quality: 'okay',
        en: 'I will feel a little sad but try harder next time.',
        hi: 'मुझे थोड़ा बुरा लगेगा पर मैं अगली बार और मेहनत करूँगा।',
        consequence_en: 'You use the feeling to motivate yourself.',
        consequence_hi: 'तुम इस भावना का इस्तेमाल खुद को प्रेरित करने के लिए करते हो।',
      },
      {
        label: 'C', icon: '😾', quality: 'poor',
        en: 'I will say the teacher is unfair and I am always ignored.',
        hi: 'मैं कहूँगा टीचर पक्षपाती है और मुझे हमेशा नज़रअंदाज़ किया जाता है।',
        consequence_en: 'The teacher hears you and feels disappointed.',
        consequence_hi: 'टीचर सुन लेती है और निराश होती है।',
      },
    ],
  },
  {
    id: 'mod_15',
    level: 'moderate',
    en: 'Your teammate did not help during the activity.',
    hi: 'टीम का एक बच्चा काम में बिल्कुल मदद नहीं कर रहा था।',
    choices: [
      {
        label: 'A', icon: '💬', quality: 'best',
        en: 'I will calmly talk to them and ask if they need help understanding.',
        hi: 'मैं शांति से बात करूँगा और पूछूँगा कि क्या उन्हें समझ नहीं आया।',
        consequence_en: 'They open up and the team works better together.',
        consequence_hi: 'वे खुलकर बात करते हैं और टीम मिलकर बेहतर काम करती है।',
      },
      {
        label: 'B', icon: '😮‍💨', quality: 'okay',
        en: 'I will do their part too and finish the work.',
        hi: 'मैं उनका हिस्सा भी कर दूँगा और काम पूरा कर लूँगा।',
        consequence_en: 'The work gets done but you feel tired.',
        consequence_hi: 'काम तो हो जाता है पर तुम थक जाते हो।',
      },
      {
        label: 'C', icon: '🗣️', quality: 'poor',
        en: 'I will argue with them in front of everyone.',
        hi: 'मैं सबके सामने उनसे लड़ाई करूँगा।',
        consequence_en: 'The whole team gets upset and the work suffers.',
        consequence_hi: 'पूरी टीम परेशान हो जाती है और काम बिगड़ जाता है।',
      },
    ],
  },
  {
    id: 'mod_16',
    level: 'moderate',
    en: 'Your best friend did not talk to you all day.',
    hi: 'तुम्हारा सबसे अच्छा दोस्त पूरे दिन तुमसे बात नहीं कर रहा था।',
    choices: [
      {
        label: 'A', icon: '🫶', quality: 'best',
        en: 'I will ask them gently if everything is okay.',
        hi: 'मैं प्यार से पूछूँगा कि सब ठीक है?',
        consequence_en: 'Your friend shares a problem and you help them.',
        consequence_hi: 'दोस्त कोई परेशानी बताता है और तुम मदद करते हो।',
      },
      {
        label: 'B', icon: '⏳', quality: 'okay',
        en: 'I will give them space and wait for them to come to me.',
        hi: 'मैं उन्हें थोड़ा समय दूँगा और इंतज़ार करूँगा।',
        consequence_en: 'They come to you later when they feel ready.',
        consequence_hi: 'वे बाद में तैयार होने पर खुद आते हैं।',
      },
      {
        label: 'C', icon: '🚫', quality: 'poor',
        en: 'I will also stop talking to them to teach them a lesson.',
        hi: 'मैं भी उनसे बात करना बंद कर दूँगा ताकि उन्हें सबक मिले।',
        consequence_en: 'Both of you feel hurt and the friendship suffers.',
        consequence_hi: 'तुम दोनों को दुख होता है और दोस्ती को नुकसान पहुँचता है।',
      },
    ],
  },
  {
    id: 'mod_17',
    level: 'moderate',
    en: 'Someone accidentally tore your notebook.',
    hi: 'किसी से गलती से तुम्हारी कॉपी फट गई।',
    choices: [
      {
        label: 'A', icon: '🙂', quality: 'best',
        en: 'I will say it is okay since it was an accident and it can be fixed.',
        hi: 'मैं कहूँगा कोई बात नहीं, गलती हो जाती है, ठीक हो जाएगी।',
        consequence_en: 'The person feels relieved and is grateful to you.',
        consequence_hi: 'सामने वाले को राहत मिलती है और वह तुम्हारा आभारी होता है।',
      },
      {
        label: 'B', icon: '😔', quality: 'okay',
        en: 'I will feel upset but not say anything mean.',
        hi: 'मुझे बुरा लगेगा पर मैं कुछ गलत नहीं बोलूँगा।',
        consequence_en: 'You manage your feelings well even though you are sad.',
        consequence_hi: 'तुम दुखी होते हुए भी अपनी भावनाएँ अच्छे से सँभालते हो।',
      },
      {
        label: 'C', icon: '😠', quality: 'poor',
        en: 'I will shout at them and say they always ruin everything.',
        hi: 'मैं उन पर चिल्लाऊँगा और कहूँगा तुम हमेशा सब बिगाड़ देते हो।',
        consequence_en: 'They feel very bad even though it was a mistake.',
        consequence_hi: 'उन्हें बहुत बुरा लगता है जबकि यह गलती से हुआ था।',
      },
    ],
  },
  {
    id: 'mod_18',
    level: 'moderate',
    en: 'You forgot your sports shoes at home.',
    hi: 'तुम अपने स्पोर्ट्स शूज़ घर पर भूल आए।',
    choices: [
      {
        label: 'A', icon: '🗣️', quality: 'best',
        en: 'I will tell the teacher honestly and ask if I can still participate.',
        hi: 'मैं टीचर को सच बताऊँगा और पूछूँगा कि क्या मैं फिर भी भाग ले सकता हूँ।',
        consequence_en: 'The teacher appreciates your honesty and finds a solution.',
        consequence_hi: 'टीचर तुम्हारी ईमानदारी की तारीफ़ करती है और हल निकालती है।',
      },
      {
        label: 'B', icon: '📝', quality: 'okay',
        en: 'I will sit and watch and remind myself to pack tomorrow.',
        hi: 'मैं बैठकर देखूँगा और याद करूँगा कि कल पैक करना है।',
        consequence_en: 'You miss out today but learn to be more prepared.',
        consequence_hi: 'आज मौका चूक जाता है पर तुम तैयार रहना सीखते हो।',
      },
      {
        label: 'C', icon: '👟', quality: 'poor',
        en: "I will borrow someone else's shoes without asking.",
        hi: 'मैं बिना पूछे किसी के जूते पहन लूँगा।',
        consequence_en: 'The owner is upset when they find out.',
        consequence_hi: 'मालिक को पता चलने पर वह परेशान हो जाता है।',
      },
    ],
  },
  {
    id: 'mod_19',
    level: 'moderate',
    en: 'You were blamed for something you did not do.',
    hi: 'तुमने कुछ नहीं किया, फिर भी सबने तुम्हें दोष दिया।',
    choices: [
      {
        label: 'A', icon: '🧘', quality: 'best',
        en: 'I will calmly explain my side and ask for a chance to prove it.',
        hi: 'मैं शांति से अपनी बात कहूँगा और खुद को साबित करने का मौका माँगूँगा।',
        consequence_en: 'The truth comes out and people understand.',
        consequence_hi: 'सच सामने आता है और लोग समझ जाते हैं।',
      },
      {
        label: 'B', icon: '⌛', quality: 'okay',
        en: 'I will feel upset but wait for the truth to come out on its own.',
        hi: 'मुझे बुरा लगेगा पर मैं खुद सच सामने आने का इंतज़ार करूँगा।',
        consequence_en: 'It takes time but eventually the truth is known.',
        consequence_hi: 'समय लगता है पर आखिरकार सच सामने आ जाता है।',
      },
      {
        label: 'C', icon: '👉', quality: 'poor',
        en: 'I will start blaming someone else to avoid getting in trouble.',
        hi: 'मैं मुसीबत से बचने के लिए किसी दूसरे पर दोष लगाना शुरू कर दूँगा।',
        consequence_en: 'An innocent person gets in trouble because of you.',
        consequence_hi: 'एक बेगुनाह बच्चा तुम्हारी वजह से मुसीबत में पड़ जाता है।',
      },
    ],
  },
  {
    id: 'mod_20',
    level: 'moderate',
    en: 'You missed the school bus.',
    hi: 'आज तुमसे स्कूल बस छूट गई।',
    choices: [
      {
        label: 'A', icon: '📞', quality: 'best',
        en: 'I will call my parents right away and let them know.',
        hi: 'मैं तुरंत माँ-पापा को फ़ोन करूँगा और बताऊँगा।',
        consequence_en: 'Your parents come quickly and you get to school safely.',
        consequence_hi: 'माँ-पापा जल्दी आते हैं और तुम सुरक्षित स्कूल पहुँच जाते हो।',
      },
      {
        label: 'B', icon: '🏠', quality: 'okay',
        en: 'I will wait at the bus stop and ask a neighbour for help.',
        hi: 'मैं बस स्टॉप पर रुकूँगा और किसी पड़ोसी से मदद माँगूँगा।',
        consequence_en: 'A trusted neighbour helps you contact your family.',
        consequence_hi: 'एक भरोसेमंद पड़ोसी परिवार से संपर्क करने में मदद करता है।',
      },
      {
        label: 'C', icon: '🛣️', quality: 'poor',
        en: 'I will start walking to school alone on a busy road.',
        hi: 'मैं अकेले व्यस्त सड़क पर पैदल स्कूल की तरफ़ चलने लगूँगा।',
        consequence_en: 'This is unsafe and your parents are very worried.',
        consequence_hi: 'यह सुरक्षित नहीं है और माँ-पापा बहुत चिंतित हो जाते हैं।',
      },
    ],
  },
  {
    id: 'adv_21',
    level: 'advanced',
    en: 'You saw a group of children teasing another child.',
    hi: 'तुमने देखा कि कुछ बच्चे मिलकर एक बच्चे को परेशान कर रहे हैं।',
    choices: [
      {
        label: 'A', icon: '👩‍🏫', quality: 'best',
        en: 'I will tell a teacher immediately and check on the child being teased.',
        hi: 'मैं तुरंत टीचर को बताऊँगा और परेशान बच्चे से मिलूँगा।',
        consequence_en: 'The teacher stops the bullying and the child feels safe again.',
        consequence_hi: 'टीचर तंग करना बंद करवाती है और बच्चा फिर से सुरक्षित महसूस करता है।',
      },
      {
        label: 'B', icon: '🧍', quality: 'okay',
        en: 'I will go to the child being teased and stand with them.',
        hi: 'मैं परेशान बच्चे के पास जाऊँगा और उसके साथ खड़ा रहूँगा।',
        consequence_en: 'The child feels less alone and the teasing stops.',
        consequence_hi: 'बच्चा कम अकेला महसूस करता है और तंग करना बंद हो जाता है।',
      },
      {
        label: 'C', icon: '🙈', quality: 'poor',
        en: 'I will watch and not get involved because it is none of my business.',
        hi: 'मैं देखता रहूँगा और बीच में नहीं पड़ूँगा क्योंकि यह मेरा मामला नहीं है।',
        consequence_en: 'The child suffers longer because no one helped.',
        consequence_hi: 'कोई मदद न करने की वजह से बच्चा और देर तक परेशान रहता है।',
      },
    ],
  },
  {
    id: 'adv_22',
    level: 'advanced',
    en: 'A stranger offered you chocolates outside school.',
    hi: 'स्कूल के बाहर एक अजनबी ने तुम्हें चॉकलेट दी।',
    choices: [
      {
        label: 'A', icon: '🛡️', quality: 'best',
        en: 'I will politely say no and walk straight to my teacher or parent.',
        hi: 'मैं विनम्रता से मना करूँगा और सीधे टीचर या माँ-पापा के पास जाऊँगा।',
        consequence_en: 'You stay safe and the adult can check on the stranger.',
        consequence_hi: 'तुम सुरक्षित रहते हो और बड़े उस अजनबी के बारे में जाँच कर सकते हैं।',
      },
      {
        label: 'B', icon: '🚶', quality: 'okay',
        en: 'I will ignore them and quickly walk away.',
        hi: 'मैं उन्हें नज़रअंदाज़ करूँगा और जल्दी से चला जाऊँगा।',
        consequence_en: 'You stay safe but do not tell an adult.',
        consequence_hi: 'तुम सुरक्षित रहते हो पर किसी बड़े को नहीं बताते।',
      },
      {
        label: 'C', icon: '🍫', quality: 'poor',
        en: 'I will take the chocolates because they look nice.',
        hi: 'मैं चॉकलेट ले लूँगा क्योंकि वे अच्छी लग रही हैं।',
        consequence_en: 'This is dangerous. You must never take things from strangers.',
        consequence_hi: 'यह खतरनाक है। अजनबियों से कभी कुछ नहीं लेना चाहिए।',
      },
    ],
  },
  {
    id: 'adv_23',
    level: 'advanced',
    en: 'Your friend asked you to lie to the teacher.',
    hi: "तुम्हारा दोस्त कहता है, 'टीचर से झूठ बोल देना।'",
    choices: [
      {
        label: 'A', icon: '💡', quality: 'best',
        en: 'I will refuse to lie and tell my friend why honesty is important.',
        hi: 'मैं झूठ बोलने से मना करूँगा और दोस्त को बताऊँगा कि ईमानदारी क्यों ज़रूरी है।',
        consequence_en: 'Your friend understands and respects your honesty.',
        consequence_hi: 'दोस्त समझता है और तुम्हारी ईमानदारी की इज़्ज़त करता है।',
      },
      {
        label: 'B', icon: '🤐', quality: 'okay',
        en: 'I will refuse to lie but also not tell the teacher on my friend.',
        hi: 'मैं झूठ बोलने से मना कर दूँगा पर टीचर को दोस्त की बात भी नहीं बताऊँगा।',
        consequence_en: 'You stay honest but also protect your friendship.',
        consequence_hi: 'तुम ईमानदार रहते हो और दोस्ती भी बचाते हो।',
      },
      {
        label: 'C', icon: '🤥', quality: 'poor',
        en: 'I will lie to the teacher to help my friend avoid trouble.',
        hi: 'मैं दोस्त को मुसीबत से बचाने के लिए टीचर से झूठ बोल दूँगा।',
        consequence_en: 'The lie is discovered later and you both get in trouble.',
        consequence_hi: 'बाद में झूठ पकड़ा जाता है और तुम दोनों मुसीबत में पड़ते हो।',
      },
    ],
  },
  {
    id: 'adv_24',
    level: 'advanced',
    en: 'You saw a classmate cheating during an exam.',
    hi: 'तुमने देखा कि एक बच्चा परीक्षा में नकल कर रहा है।',
    choices: [
      {
        label: 'A', icon: '🤫', quality: 'best',
        en: 'I will quietly tell the teacher after the exam.',
        hi: 'मैं परीक्षा के बाद चुपचाप टीचर को बताऊँगा।',
        consequence_en: 'The teacher handles it fairly and cheating decreases.',
        consequence_hi: 'टीचर उचित कदम उठाती है और नकल कम होती है।',
      },
      {
        label: 'B', icon: '📝', quality: 'okay',
        en: 'I will focus on my own paper and not cheat myself.',
        hi: 'मैं अपने पेपर पर ध्यान दूँगा और खुद नकल नहीं करूँगा।',
        consequence_en: 'You stay honest even when others are not.',
        consequence_hi: 'तुम तब भी ईमानदार रहते हो जब बाकी नहीं होते।',
      },
      {
        label: 'C', icon: '👀', quality: 'poor',
        en: 'I will copy from them too since everyone seems to be doing it.',
        hi: 'मैं भी उनसे नकल कर लूँगा क्योंकि लगता है सब यही कर रहे हैं।',
        consequence_en: 'You both get caught and lose marks for dishonesty.',
        consequence_hi: 'तुम दोनों पकड़े जाते हो और बेईमानी के लिए नंबर कट जाते हैं।',
      },
    ],
  },
  {
    id: 'adv_25',
    level: 'advanced',
    en: 'You found ₹500 on the playground.',
    hi: 'खेल के मैदान में तुम्हें ₹500 मिले।',
    choices: [
      {
        label: 'A', icon: '🙋', quality: 'best',
        en: 'I will hand it in to the teacher straight away.',
        hi: 'मैं तुरंत टीचर को दे दूँगा।',
        consequence_en: 'The owner gets their money back and thanks you.',
        consequence_hi: 'मालिक को पैसे वापस मिल जाते हैं और वह तुम्हें धन्यवाद देता है।',
      },
      {
        label: 'B', icon: '❓', quality: 'okay',
        en: 'I will ask my friends if anyone lost money.',
        hi: 'मैं दोस्तों से पूछूँगा कि किसी के पैसे गुम हुए हैं क्या।',
        consequence_en: 'You find the owner by asking around.',
        consequence_hi: 'पूछने पर मालिक मिल जाता है।',
      },
      {
        label: 'C', icon: '🛍️', quality: 'poor',
        en: 'I will keep the money and buy something for myself.',
        hi: 'मैं पैसे अपने पास रख लूँगा और खुद के लिए कुछ खरीद लूँगा।',
        consequence_en: 'Someone is very upset about losing their money.',
        consequence_hi: 'किसी को पैसे खोने का बहुत दुख होता है।',
      },
    ],
  },
  {
    id: 'adv_26',
    level: 'advanced',
    en: "Your friend told everyone someone else's secret.",
    hi: 'तुम्हारे दोस्त ने किसी और की राज़ वाली बात सबको बता दी।',
    choices: [
      {
        label: 'A', icon: '💬', quality: 'best',
        en: 'I will tell my friend privately that sharing secrets hurts people.',
        hi: 'मैं अकेले में दोस्त को बताऊँगा कि राज़ बताने से लोगों को दुख होता है।',
        consequence_en: 'Your friend reflects and apologises to the other child.',
        consequence_hi: 'दोस्त सोचता है और उस बच्चे से माफ़ी माँगता है।',
      },
      {
        label: 'B', icon: '🫂', quality: 'okay',
        en: 'I will check on the child whose secret was shared.',
        hi: 'मैं उस बच्चे से मिलूँगा जिसका राज़ बताया गया।',
        consequence_en: 'The child feels supported knowing someone cares.',
        consequence_hi: 'बच्चे को अच्छा लगता है कि कोई उसकी परवाह करता है।',
      },
      {
        label: 'C', icon: '😂', quality: 'poor',
        en: 'I will laugh along with the others.',
        hi: 'मैं भी दूसरों के साथ हँसूँगा।',
        consequence_en: 'The child whose secret was shared feels deeply hurt.',
        consequence_hi: 'जिसका राज़ बताया गया उसे बहुत गहरी चोट लगती है।',
      },
    ],
  },
  {
    id: 'adv_27',
    level: 'advanced',
    en: 'Your team refused to let another child join the game.',
    hi: 'तुम्हारी टीम ने एक बच्चे को अपने साथ खेलने नहीं दिया।',
    choices: [
      {
        label: 'A', icon: '📣', quality: 'best',
        en: 'I will speak up and say everyone deserves a chance to play.',
        hi: 'मैं बोलूँगा कि सबको खेलने का मौका मिलना चाहिए।',
        consequence_en: 'The child joins and the game becomes more fun.',
        consequence_hi: 'बच्चा शामिल हो जाता है और खेल और मज़ेदार हो जाता है।',
      },
      {
        label: 'B', icon: '⚽', quality: 'okay',
        en: 'I will go and play with that child separately.',
        hi: 'मैं उस बच्चे के साथ अलग से खेलने जाऊँगा।',
        consequence_en: 'The child feels included and happy.',
        consequence_hi: 'बच्चा शामिल महसूस करता है और खुश हो जाता है।',
      },
      {
        label: 'C', icon: '🤐', quality: 'poor',
        en: 'I will stay quiet because I do not want the team to get angry at me.',
        hi: 'मैं चुप रहूँगा क्योंकि मैं नहीं चाहता कि टीम मुझ पर नाराज़ हो।',
        consequence_en: 'The child feels left out and sad. You feel guilty.',
        consequence_hi: 'बच्चा बाहर और दुखी महसूस करता है। तुम्हें भी पश्चाताप होता है।',
      },
    ],
  },
  {
    id: 'adv_28',
    level: 'advanced',
    en: 'You accidentally posted a mean message in the class WhatsApp group.',
    hi: 'तुमसे गलती से क्लास के व्हाट्सऐप ग्रुप में किसी के बारे में बुरा मैसेज चला गया।',
    choices: [
      {
        label: 'A', icon: '🙏', quality: 'best',
        en: 'I will immediately apologise in the group and speak to the person privately.',
        hi: 'मैं तुरंत ग्रुप में माफ़ी माँगूँगा और उस बच्चे से अकेले में बात करूँगा।',
        consequence_en: 'The person forgives you and the group moves on.',
        consequence_hi: 'वह बच्चा माफ़ कर देता है और ग्रुप आगे बढ़ जाता है।',
      },
      {
        label: 'B', icon: '🗑️', quality: 'okay',
        en: 'I will delete the message quickly and apologise privately.',
        hi: 'मैं मैसेज जल्दी डिलीट करूँगा और निजी में माफ़ी माँगूँगा।',
        consequence_en: 'Some people saw it but the child accepts your apology.',
        consequence_hi: 'कुछ लोगों ने देख लिया पर बच्चा माफ़ी स्वीकार कर लेता है।',
      },
      {
        label: 'C', icon: '🃏', quality: 'poor',
        en: 'I will pretend it was a joke and say people are too sensitive.',
        hi: 'मैं कहूँगा यह तो मज़ाक था और लोग बहुत नाज़ुक हैं।',
        consequence_en: 'The person feels worse and loses trust in you.',
        consequence_hi: 'बच्चे को और बुरा लगता है और तुम पर से भरोसा उठ जाता है।',
      },
    ],
  },
  {
    id: 'adv_29',
    level: 'advanced',
    en: 'A younger child is crying because they cannot find their classroom.',
    hi: 'एक छोटा बच्चा रो रहा है क्योंकि उसे अपनी क्लास नहीं मिल रही।',
    choices: [
      {
        label: 'A', icon: '🧑‍🏫', quality: 'best',
        en: 'I will take them to a teacher right away.',
        hi: 'मैं उन्हें तुरंत टीचर के पास ले जाऊँगा।',
        consequence_en: 'The child reaches their class safely and feels calm.',
        consequence_hi: 'बच्चा सुरक्षित अपनी क्लास पहुँच जाता है और शांत हो जाता है।',
      },
      {
        label: 'B', icon: '🫶', quality: 'okay',
        en: 'I will gently ask their name and which class they are in.',
        hi: 'मैं प्यार से उनका नाम और क्लास पूछूँगा।',
        consequence_en: 'You help them find their way with a little more time.',
        consequence_hi: 'थोड़ा समय लगता है पर तुम उनका रास्ता ढूँढने में मदद करते हो।',
      },
      {
        label: 'C', icon: '🏃', quality: 'poor',
        en: 'I will walk past because I am getting late for my class.',
        hi: 'मैं आगे बढ़ जाऊँगा क्योंकि मुझे अपनी क्लास के लिए देर हो रही है।',
        consequence_en: 'The small child is left alone and scared.',
        consequence_hi: 'छोटा बच्चा अकेला और डरा हुआ रह जाता है।',
      },
    ],
  },
  {
    id: 'adv_30',
    level: 'advanced',
    en: 'You saw someone taking school supplies that did not belong to them.',
    hi: 'तुमने देखा कि कोई बच्चा स्कूल की चीज़ें बिना पूछे ले जा रहा है।',
    choices: [
      {
        label: 'A', icon: '🤫', quality: 'best',
        en: 'I will quietly tell a teacher what I saw.',
        hi: 'मैं चुपचाप टीचर को बताऊँगा जो मैंने देखा।',
        consequence_en: 'The school supplies are returned and the issue is handled.',
        consequence_hi: 'स्कूल की चीज़ें वापस आ जाती हैं और मामला सुलझ जाता है।',
      },
      {
        label: 'B', icon: '💬', quality: 'okay',
        en: 'I will tell the child I saw them and ask them to return it.',
        hi: 'मैं उस बच्चे को बताऊँगा कि मैंने देखा और वापस करने को कहूँगा।',
        consequence_en: 'The child returns the supplies and feels ashamed.',
        consequence_hi: 'बच्चा चीज़ें वापस करता है और शर्मिंदा महसूस करता है।',
      },
      {
        label: 'C', icon: '🙈', quality: 'poor',
        en: 'I will do nothing because I do not want to get involved.',
        hi: 'मैं कुछ नहीं करूँगा क्योंकि मैं बीच में नहीं पड़ना चाहता।',
        consequence_en: 'The behaviour continues and more things go missing.',
        consequence_hi: 'यह सिलसिला जारी रहता है और और चीज़ें गायब होती रहती हैं।',
      },
    ],
  },
]

const LEVEL_ORDER: Level[] = ['easy', 'moderate', 'advanced']

const LEVEL_BADGE: Record<Level, { bg: string; color: string; label: string }> = {
  easy: { bg: '#e8f5ee', color: '#1a6e40', label: 'Easy' },
  moderate: { bg: '#fef9e7', color: '#8a6010', label: 'Moderate' },
  advanced: { bg: '#faeee7', color: '#8a3010', label: 'Advanced' },
}

const QUALITY_ACCENT: Record<Quality, string> = {
  best: '#4caf86',
  okay: '#f0c030',
  poor: '#c8602a',
}

const QUALITY_ICON: Record<Quality, string> = { best: '⭐', okay: '👍', poor: '❗' }

const SELECTED_STYLE: Record<Quality, { background: string; border: string }> = {
  best: { background: 'rgba(74,124,111,0.22)', border: '1px solid rgba(74,124,111,0.5)' },
  okay: { background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.25)' },
  poor: { background: 'rgba(200,96,42,0.15)', border: '1px solid rgba(200,96,42,0.3)' },
}

const FACILITATOR_QS: { en: string; hi: string }[] = [
  { en: 'Why did you choose this option?', hi: 'तुमने यही जवाब क्यों चुना?' },
  { en: 'What do you think will happen next?', hi: 'तुम्हें क्या लगता है, आगे क्या होगा?' },
  { en: 'How would the other person feel?', hi: 'दूसरे बच्चे को कैसा लगेगा?' },
  { en: 'Would you make the same choice in real life?', hi: 'अगर सच में ऐसा हो, तो क्या तुम यही करोगे?' },
]

const DEVANAGARI = "'Noto Sans Devanagari', 'DM Sans', sans-serif"

const scenariosFor = (level: Level) => SCENARIOS.filter((s) => s.level === level)

/* ══════════════════════════════════════════════════════════════════════
   ILLUSTRATED SCENE SYSTEM  —  reusable, built once, applied to all 30
   scenarios via SCENE_META tags. No scenario text/data is touched.
   ══════════════════════════════════════════════════════════════════════ */

/* Per-scenario scene tags — text data lives untouched in SCENARIOS above.
   Each of the 30 ids maps to one of the 5 animation verbs + a setting. */
const SCENE_META: Record<string, SceneMeta> = {
  easy_1: { verb: 'waiting', setting: 'home', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  easy_2: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#e08a3c', bubble: 'HMM...' },
  easy_3: { verb: 'spill', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'OOPS!!', object: 'cup' },
  easy_4: { verb: 'social', setting: 'home', pose: 'happy', shirt: '#4a7c6f', friendShirt: '#d95c7a', bubble: 'HI!' },
  easy_5: { verb: 'social', setting: 'playground', pose: 'surprised', shirt: '#3d84c6', friendShirt: '#f0b400', bubble: 'YAY!' },
  easy_6: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#6b5ce7', bubble: 'HMM...' },
  easy_7: { verb: 'accident', setting: 'playground', pose: 'worried', shirt: '#4a7c6f', bubble: 'OH NO...' },
  easy_8: { verb: 'achievement', setting: 'home', pose: 'happy', shirt: '#4a7c6f', bubble: 'YAY!!' },
  easy_9: { verb: 'achievement', setting: 'classroom', pose: 'happy', shirt: '#3d84c6', bubble: 'WOOHOO!' },
  easy_10: { verb: 'social', setting: 'canteen', pose: 'happy', shirt: '#4a7c6f', friendShirt: '#e08a3c', bubble: 'YAY!' },
  mod_11: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_12: { verb: 'accident', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'UH OH...' },
  mod_13: { verb: 'accident', setting: 'playground', pose: 'sad', shirt: '#c0504a', bubble: 'OH NO...' },
  mod_14: { verb: 'waiting', setting: 'classroom', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_15: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_16: { verb: 'waiting', setting: 'hallway', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_17: { verb: 'accident', setting: 'classroom', pose: 'sad', shirt: '#4a7c6f', bubble: 'OH NO...', object: 'book' },
  mod_18: { verb: 'accident', setting: 'home', pose: 'worried', shirt: '#4a7c6f', bubble: 'UH OH...', object: 'shoe' },
  mod_19: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_20: { verb: 'waiting', setting: 'park', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_21: { verb: 'waiting', setting: 'playground', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_22: { verb: 'waiting', setting: 'park', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_23: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_24: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_25: { verb: 'waiting', setting: 'playground', pose: 'surprised', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_26: { verb: 'waiting', setting: 'canteen', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_27: { verb: 'waiting', setting: 'playground', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_28: { verb: 'accident', setting: 'home', pose: 'worried', shirt: '#4a7c6f', bubble: 'UH OH...', object: 'phone' },
  adv_29: { verb: 'social', setting: 'hallway', pose: 'worried', shirt: '#4a7c6f', friendShirt: '#f0b400', bubble: 'HMM...' },
  adv_30: { verb: 'waiting', setting: 'hallway', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
}

export default function StoryChoiceAdventure({ sessionId, role, isLocked }: StoryChoiceAdventureProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [scenarioId, setScenarioId] = useState('easy_1')
  const [selected, setSelected] = useState<'A' | 'B' | 'C' | null>(null)
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState<Level>('easy')
  const [language, setLanguage] = useState<Lang>('both')
  const [levelComplete, setLevelComplete] = useState(false)
  // Therapist-only, private UI toggle for the facilitator questions popover.
  // Local state only — intentionally NOT synced to Firestore.
  const [facOpen, setFacOpen] = useState(false)

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.scaCurrentScenarioId === 'string') setScenarioId(s.scaCurrentScenarioId)
      if (s.scaSelectedChoice === null || s.scaSelectedChoice === 'A' || s.scaSelectedChoice === 'B' || s.scaSelectedChoice === 'C') setSelected(s.scaSelectedChoice)
      if (typeof s.scaScore === 'number') setScore(s.scaScore)
      if (s.scaLevel === 'easy' || s.scaLevel === 'moderate' || s.scaLevel === 'advanced') setLevel(s.scaLevel)
      if (s.scaLanguage === 'en' || s.scaLanguage === 'hi' || s.scaLanguage === 'both') setLanguage(s.scaLanguage)
      if (typeof s.scaLevelComplete === 'boolean') setLevelComplete(s.scaLevelComplete)
    })
    return () => unsub()
  }, [sessionId])

  const levelScenarios = useMemo(() => scenariosFor(level), [level])
  const scenario = useMemo(
    () => levelScenarios.find((s) => s.id === scenarioId) ?? levelScenarios[0],
    [levelScenarios, scenarioId]
  )
  const idx = levelScenarios.findIndex((s) => s.id === scenario.id)
  const isLast = idx === levelScenarios.length - 1
  const selectedChoice = selected ? scenario.choices.find((c) => c.label === selected) ?? null : null

  const showEn = language === 'en' || language === 'both'
  const showHi = language === 'hi' || language === 'both'
  const bodySize = language === 'both' ? 13 : 14

  const handleSelect = useCallback((choice: Choice) => {
    if (isLocked && !isT) return
    if (selected) return
    const payload: Record<string, unknown> = {
      'moduleState.scaSelectedChoice': choice.label,
      'moduleState.scaSessionAnswers': arrayUnion({
        scenarioId: scenario.id,
        choice: choice.label,
        isCorrect: choice.quality === 'best',
      }),
    }
    if (choice.quality === 'best') payload['moduleState.scaScore'] = increment(1)
    write(payload)
    logModuleEvent(sessionId, {
      module: 'story-choice-adventure',
      type: 'choice_selected',
      detail: `${scenario.id} (${level}): chose ${choice.label} — ${choice.quality}. "${scenario.en}"`,
    })
  }, [isLocked, isT, selected, scenario, level, write, sessionId])

  const handleNext = useCallback(() => {
    if (!isT) return
    if (isLast) {
      write({ 'moduleState.scaLevelComplete': true })
      logModuleEvent(sessionId, {
        module: 'story-choice-adventure',
        type: 'level_completed',
        detail: `Completed ${level} level with score ${score}/${levelScenarios.length}.`,
      })
      return
    }
    write({
      'moduleState.scaCurrentScenarioId': levelScenarios[idx + 1].id,
      'moduleState.scaSelectedChoice': null,
    })
  }, [isT, isLast, idx, levelScenarios, write, sessionId, level, score])

  const startLevel = useCallback((next: Level) => {
    if (!isT) return
    write({
      'moduleState.scaLevel': next,
      'moduleState.scaCurrentScenarioId': scenariosFor(next)[0].id,
      'moduleState.scaSelectedChoice': null,
      'moduleState.scaScore': 0,
      'moduleState.scaLevelComplete': false,
    })
  }, [isT, write])

  const nextLevel = LEVEL_ORDER[LEVEL_ORDER.indexOf(level) + 1] as Level | undefined

  const scoreBand = useMemo(() => {
    if (score >= 8) return { color: '#4caf86', msg: 'Excellent!' }
    if (score >= 5) return { color: '#f0c030', msg: 'Good effort!' }
    return { color: '#c8602a', msg: 'Keep practising!' }
  }, [score])

  const badge = LEVEL_BADGE[level]

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'safe center',
        minHeight: '100%', width: '100%', overflowY: 'auto', color: '#fff', padding: '12px 0',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%', maxWidth: 760, padding: 24 }}>
      {/* 1 — Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40 }}>
        <span style={{ flexShrink: 0, background: badge.bg, color: badge.color, fontSize: 13, fontWeight: 700, padding: '3px 9px', borderRadius: 999 }}>
          {badge.label}
        </span>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 14, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>
          Story Choice Adventure
        </span>
        {isT ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: 2 }}>
              {([['en', 'EN'], ['hi', 'हिं'], ['both', 'Both']] as [Lang, string][]).map(([key, txt]) => (
                <button
                  key={key}
                  onClick={() => write({ 'moduleState.scaLanguage': key })}
                  style={{
                    border: 'none', cursor: 'pointer', borderRadius: 999, padding: '3px 7px', fontSize: 13, fontWeight: 600,
                    fontFamily: key === 'hi' ? DEVANAGARI : undefined,
                    background: language === key ? 'rgba(74,124,111,0.35)' : 'transparent',
                    color: language === key ? '#cfe6df' : 'rgba(255,255,255,0.45)',
                    transition: 'all 0.15s',
                  }}
                >
                  {txt}
                </button>
              ))}
            </div>
            <button
              onClick={() => startLevel(level)}
              title="Reset level"
              style={{
                width: 24, height: 24, borderRadius: 6, cursor: 'pointer', fontSize: 14,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.6)',
              }}
            >
              ↻
            </button>
          </div>
        ) : null}
      </div>

      {/* Therapist level selector */}
      {isT && (
        <div style={{ display: 'flex', gap: 4 }}>
          {LEVEL_ORDER.map((l) => (
            <button
              key={l}
              onClick={() => startLevel(l)}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
                background: level === l ? 'rgba(74,124,111,0.3)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${level === l ? 'rgba(74,124,111,0.45)' : 'rgba(255,255,255,0.1)'}`,
                color: level === l ? '#cfe6df' : 'rgba(255,255,255,0.45)',
                transition: 'all 0.15s',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {/* 2 — Progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <motion.div
            animate={{ width: `${((levelComplete ? levelScenarios.length : idx + 1) / levelScenarios.length) * 100}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            style={{ height: '100%', background: 'rgba(74,124,111,0.7)', borderRadius: 999 }}
          />
        </div>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}>
          {levelComplete ? levelScenarios.length : idx + 1} / {levelScenarios.length}
        </span>
      </div>

      <AnimatePresence mode="wait">
        {levelComplete ? (
          /* Level complete card */
          <motion.div
            key="complete"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 14,
              padding: 20, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}
          >
            <div style={{ fontSize: 44, lineHeight: 1 }}>🎉</div>
            <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 23.5 }}>Level complete!</div>
            <div style={{ fontSize: 17.5, color: 'rgba(255,255,255,0.8)' }}>
              Score: {score} / {levelScenarios.length}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: scoreBand.color }}>{scoreBand.msg}</div>
            {isT && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 6 }}>
                {nextLevel && (
                  <button
                    onClick={() => startLevel(nextLevel)}
                    style={{
                      width: '100%', padding: '8px 0', borderRadius: 999, cursor: 'pointer', fontSize: 16, fontWeight: 600,
                      background: 'rgba(74,124,111,0.3)', border: '1px solid rgba(74,124,111,0.45)', color: '#cfe6df',
                    }}
                  >
                    Next level →
                  </button>
                )}
                <button
                  onClick={() => startLevel(level)}
                  style={{
                    width: '100%', padding: '7px 0', borderRadius: 999, cursor: 'pointer', fontSize: 14,
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.6)',
                  }}
                >
                  Restart level
                </button>
                <button
                  onClick={() => {
                    write({
                      'moduleState.scaLevel': 'easy',
                      'moduleState.scaCurrentScenarioId': 'easy_1',
                      'moduleState.scaSelectedChoice': null,
                      'moduleState.scaScore': 0,
                      'moduleState.scaLevelComplete': false,
                    })
                    logModuleEvent(sessionId, {
                      module: 'story-choice-adventure',
                      type: 'module_ended',
                      detail: `Therapist ended the module after the ${level} level (score ${score}/${levelScenarios.length}).`,
                    })
                  }}
                  style={{
                    width: '100%', padding: '7px 0', borderRadius: 999, cursor: 'pointer', fontSize: 14,
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.6)',
                  }}
                >
                  End module
                </button>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="play" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 3 — Scenario card */}
            <AnimatePresence mode="wait">
              <motion.div
                key={scenario.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 14, position: 'relative', overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 13, fontWeight: 600, color: '#5a4632', background: 'rgba(255,255,255,0.72)', padding: '1px 8px', borderRadius: 999, zIndex: 8 }}>
                  Scenario {idx + 1}
                </div>
                {/* Illustrated animated scene — shows the moment before any text */}
                <AnimatedScene meta={SCENE_META[scenario.id] ?? { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' }} />
                <div style={{ padding: 14 }}>
                  {showEn && (
                    <div style={{ fontSize: bodySize, color: 'rgba(255,255,255,0.9)', lineHeight: 1.45 }}>
                      {scenario.en}
                    </div>
                  )}
                  {language === 'both' && (
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.10)', margin: '8px 0' }} />
                  )}
                  {showHi && (
                    <div style={{ fontSize: bodySize, color: language === 'both' ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.9)', lineHeight: 1.5, fontFamily: DEVANAGARI }}>
                      {scenario.hi}
                    </div>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* 4 — Choice cards (visual-fork style: icon-ring + letter badge) */}
            <div style={{ display: 'flex', gap: 14, width: '100%' }}>
              {scenario.choices.map((choice, i) => {
                const isSel = selected === choice.label
                const dimmed = selected !== null && !isSel
                const sel = isSel ? SELECTED_STYLE[choice.quality] : null
                return (
                  <motion.button
                    key={`${scenario.id}-${choice.label}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: dimmed ? 0.45 : 1, y: 0 }}
                    transition={{ delay: selected ? 0 : i * 0.1, duration: 0.28, ease: 'easeOut' }}
                    onClick={() => handleSelect(choice)}
                    disabled={!canInteract || selected !== null}
                    style={{
                      flex: 1, minWidth: 0, borderRadius: 18, padding: '20px 14px 16px', minHeight: 140,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
                      position: 'relative', textAlign: 'center',
                      background: sel ? sel.background : 'rgba(255,255,255,0.05)',
                      border: sel ? sel.border : '1px solid rgba(255,255,255,0.10)',
                      cursor: !canInteract || selected ? 'default' : 'pointer',
                      pointerEvents: !canInteract || dimmed ? 'none' : 'auto',
                      transition: 'all 0.18s ease',
                      color: '#fff',
                    }}
                    onMouseEnter={(e) => {
                      if (!canInteract || selected) return
                      e.currentTarget.style.background = 'rgba(74,124,111,0.15)'
                      e.currentTarget.style.borderColor = 'rgba(74,124,111,0.35)'
                    }}
                    onMouseLeave={(e) => {
                      if (!canInteract || selected) return
                      e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'
                    }}
                  >
                    {/* letter badge */}
                    <span
                      style={{
                        position: 'absolute', top: 10, left: 10, width: 22, height: 22, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, color: '#fff',
                      }}
                    >
                      {choice.label}
                    </span>
                    {isSel && <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 18.5 }}>{QUALITY_ICON[choice.quality]}</span>}
                    {/* icon ring */}
                    <span
                      style={{
                        flexShrink: 0, width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.10)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 33,
                      }}
                    >
                      {choice.icon}
                    </span>
                    {/* text */}
                    <span style={{ minWidth: 0 }}>
                      {showEn && <span style={{ display: 'block', fontSize: 16.5, lineHeight: 1.35, color: 'rgba(255,255,255,0.92)' }}>{choice.en}</span>}
                      {showHi && (
                        <span style={{ display: 'block', fontSize: 15.5, fontFamily: DEVANAGARI, color: showEn ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.9)', marginTop: showEn ? 4 : 0, lineHeight: 1.4 }}>
                          {choice.hi}
                        </span>
                      )}
                    </span>
                  </motion.button>
                )
              })}
            </div>

            {/* Locked notice */}
            {!canInteract && (
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                Therapist is controlling
              </div>
            )}

            {/* 5 — Consequence reveal */}
            <AnimatePresence>
              {selectedChoice && (
                <motion.div
                  key={`${scenario.id}-consequence`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      borderLeft: `3px solid ${QUALITY_ACCENT[selectedChoice.quality]}`,
                      borderRadius: '0 8px 8px 0', padding: '16px 20px', marginTop: 10,
                    }}
                  >
                    <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', marginBottom: 5 }}>What happens next:</div>
                    {showEn && (
                      <div style={{ fontSize: 16.5, color: 'rgba(255,255,255,0.85)', lineHeight: 1.45 }}>
                        {selectedChoice.consequence_en}
                      </div>
                    )}
                    {showHi && (
                      <div style={{ fontSize: 16.5, fontFamily: DEVANAGARI, color: showEn ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.85)', lineHeight: 1.5, marginTop: showEn ? 4 : 0 }}>
                        {selectedChoice.consequence_hi}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 7 — Next button */}
            {isT && selected && (
              <button
                onClick={handleNext}
                style={{
                  width: '100%', padding: '12px 0', borderRadius: 999, cursor: 'pointer', fontSize: 16.5, fontWeight: 600,
                  background: 'rgba(74,124,111,0.3)', border: '1px solid rgba(74,124,111,0.45)', color: '#cfe6df',
                  transition: 'all 0.15s',
                }}
              >
                {isLast ? 'Finish level →' : 'Next scenario →'}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* Facilitator questions — therapist-only collapsible popover.
          Never rendered in the DOM for the client role. */}
      {isT && (
        <>
          {facOpen && (
            <>
              {/* outside-click catcher */}
              <div
                onClick={() => setFacOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 48 }}
              />
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                style={{
                  position: 'fixed', bottom: 70, right: 8, width: 260,
                  background: 'rgba(30,25,50,0.97)', borderRadius: 14,
                  border: '1px solid rgba(107,92,231,0.3)', padding: '12px 14px',
                  zIndex: 49, boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: '#a99cf0', marginBottom: 6 }}>💬 Facilitator questions</div>
                <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {FACILITATOR_QS.map((q, i) => (
                    <li key={i} style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>
                      <span style={{ display: 'block' }}>{q.en}</span>
                      <span style={{ display: 'block', fontFamily: DEVANAGARI, color: 'rgba(255,255,255,0.5)' }}>{q.hi}</span>
                    </li>
                  ))}
                </ol>
              </motion.div>
            </>
          )}
          <button
            onClick={() => setFacOpen((o) => !o)}
            title="Facilitator questions"
            style={{
              position: 'fixed', bottom: 20, right: 20, width: 44, height: 44, borderRadius: '50%',
              background: 'rgba(107,92,231,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 21, cursor: 'pointer', zIndex: 50, boxShadow: '0 6px 20px rgba(107,92,231,0.4)', border: 'none',
            }}
          >
            💬
          </button>
        </>
      )}
    </div>
  )
}
