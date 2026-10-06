'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { doc, onSnapshot, updateDoc, arrayUnion, increment } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { AnimatePresence, motion } from 'motion/react'
import { AnimatedScene } from './shared/animationVerbs'
import type { SceneMeta, Pose } from './shared/sceneTypes'

interface EmotionDetectiveProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Level = 'easy' | 'moderate' | 'advanced'
type Lang = 'en' | 'hi' | 'both'

type Emotion = { en: string; hi: string; emoji: string }

type Scenario = {
  id: string
  level: Level
  en: string
  hi: string
  correctEmotion: Emotion
  alternateEmotions: string[]
  explanation_en: string
  explanation_hi: string
}

// Every emotion offered by the picker, keyed by its English name. Distractors in
// `alternateEmotions` are resolved through this map; a scenario's correct emotion
// carries its own label/emoji so it can be phrased more precisely than the pool.
const EMOTION_POOL: Record<string, Emotion> = {
  Happy: { en: 'Happy', hi: 'खुश', emoji: '😊' },
  Sad: { en: 'Sad', hi: 'दुखी', emoji: '😢' },
  Angry: { en: 'Angry', hi: 'गुस्सा', emoji: '😤' },
  Scared: { en: 'Scared', hi: 'डरा हुआ', emoji: '😨' },
  Worried: { en: 'Worried', hi: 'चिंतित', emoji: '😟' },
  Proud: { en: 'Proud', hi: 'गर्वित', emoji: '😄' },
  Embarrassed: { en: 'Embarrassed', hi: 'शर्मिंदा', emoji: '😳' },
  Nervous: { en: 'Nervous', hi: 'घबराया हुआ', emoji: '😰' },
  Disappointed: { en: 'Disappointed', hi: 'निराश', emoji: '😞' },
  Guilty: { en: 'Guilty', hi: 'दोषी', emoji: '😔' },
  Jealous: { en: 'Jealous', hi: 'जलन', emoji: '😒' },
  Surprised: { en: 'Surprised', hi: 'हैरान', emoji: '😲' },
  Loved: { en: 'Loved', hi: 'प्यार महसूस हुआ', emoji: '🥰' },
  'Left out': { en: 'Left out', hi: 'अकेला महसूस हुआ', emoji: '😢' },
  Hurt: { en: 'Hurt', hi: 'दिल दुखा', emoji: '💔' },
  Concerned: { en: 'Concerned', hi: 'चिंतित और दयालु', emoji: '🥺' },
  Resentful: { en: 'Resentful', hi: 'मन में नाराज़गी', emoji: '😒' },
  Motivated: { en: 'Motivated', hi: 'उत्साहित', emoji: '💪' },
  Troubled: { en: 'Troubled', hi: 'परेशान', emoji: '😟' },
  Hopeless: { en: 'Hopeless', hi: 'हताश', emoji: '😔' },
  Betrayed: { en: 'Betrayed', hi: 'धोखा महसूस हुआ', emoji: '😤' },
  Humiliated: { en: 'Humiliated', hi: 'बेइज़्ज़ती', emoji: '😢' },
  Anxious: { en: 'Anxious', hi: 'चिंतित', emoji: '😟' },
  Grateful: { en: 'Grateful', hi: 'आभारी', emoji: '😲' },
  Excited: { en: 'Excited', hi: 'उत्साहित', emoji: '😄' },
  Relieved: { en: 'Relieved', hi: 'राहत महसूस हुई', emoji: '😊' },
  Warm: { en: 'Warm', hi: 'गर्माहट महसूस हुई', emoji: '😊' },
  Lonely: { en: 'Lonely', hi: 'अकेलापन', emoji: '😔' },
  Frustrated: { en: 'Frustrated', hi: 'परेशान', emoji: '😤' },
  Helpless: { en: 'Helpless', hi: 'बेबस', emoji: '😟' },
  // Not in the supplied pool list, but required by adv_29 / adv_30 distractors.
  Tired: { en: 'Tired', hi: 'थका हुआ', emoji: '😪' },
  Hopeful: { en: 'Hopeful', hi: 'उम्मीद भरा', emoji: '🌤️' },
}

const SCENARIOS: Scenario[] = [
  {
    id: 'easy_1',
    level: 'easy',
    en: 'Your friend shared their lunch with you today.',
    hi: 'आज तुम्हारे दोस्त ने अपना टिफिन तुम्हारे साथ बाँटा।',
    correctEmotion: { en: 'Happy', hi: 'खुश', emoji: '😊' },
    alternateEmotions: ['Surprised', 'Grateful', 'Excited'],
    explanation_en: 'When someone shares with us, it feels kind and makes us happy.',
    explanation_hi: 'जब कोई हमारे साथ कुछ बाँटता है, तो अच्छा लगता है और खुशी होती है।',
  },
  {
    id: 'easy_2',
    level: 'easy',
    en: 'Oops! You forgot your pencil at home.',
    hi: 'अरे! आज तुम अपनी पेंसिल घर पर ही भूल आए।',
    correctEmotion: { en: 'Worried', hi: 'चिंतित', emoji: '😟' },
    alternateEmotions: ['Sad', 'Embarrassed', 'Angry'],
    explanation_en: 'Forgetting something important usually makes us feel worried.',
    explanation_hi: 'ज़रूरी चीज़ भूलने पर आमतौर पर चिंता होती है।',
  },
  {
    id: 'easy_3',
    level: 'easy',
    en: "Your teacher smiled and said, 'Great job!'",
    hi: "टीचर ने मुस्कुराकर कहा, 'बहुत अच्छा किया!'",
    correctEmotion: { en: 'Proud', hi: 'गर्वित', emoji: '😄' },
    alternateEmotions: ['Happy', 'Surprised', 'Relieved'],
    explanation_en: 'Being praised for our own effort makes us feel proud.',
    explanation_hi: 'अपनी मेहनत की तारीफ़ सुनकर गर्व महसूस होता है।',
  },
  {
    id: 'easy_4',
    level: 'easy',
    en: 'You accidentally dropped your water bottle in class.',
    hi: 'क्लास में तुम्हारी पानी की बोतल गलती से गिर गई।',
    correctEmotion: { en: 'Embarrassed', hi: 'शर्मिंदा', emoji: '😳' },
    alternateEmotions: ['Scared', 'Sad', 'Worried'],
    explanation_en: 'When everyone looks at our mistake, we feel embarrassed.',
    explanation_hi: 'जब सब हमारी गलती देख लेते हैं, तो शर्मिंदगी महसूस होती है।',
  },
  {
    id: 'easy_5',
    level: 'easy',
    en: 'You cannot find your favourite eraser anywhere.',
    hi: 'तुम्हें अपनी पसंदीदा रबर कहीं नहीं मिल रही।',
    correctEmotion: { en: 'Frustrated', hi: 'परेशान', emoji: '😤' },
    alternateEmotions: ['Sad', 'Worried', 'Angry'],
    explanation_en: 'When we search again and again without luck, we feel frustrated.',
    explanation_hi: 'बार-बार ढूँढने पर भी चीज़ न मिले तो झुँझलाहट होती है।',
  },
  {
    id: 'easy_6',
    level: 'easy',
    en: 'Your teacher picked you to answer a question.',
    hi: 'टीचर ने तुम्हें सवाल का जवाब देने के लिए बुलाया।',
    correctEmotion: { en: 'Nervous', hi: 'घबराया हुआ', emoji: '😰' },
    alternateEmotions: ['Excited', 'Proud', 'Worried'],
    explanation_en: 'Speaking in front of the class can make our heart beat fast.',
    explanation_hi: 'क्लास के सामने बोलने से दिल तेज़ धड़कने लगता है।',
  },
  {
    id: 'easy_7',
    level: 'easy',
    en: 'Your friend waved and smiled at you.',
    hi: 'तुम्हारे दोस्त ने मुस्कुराकर तुम्हें हाथ हिलाया।',
    correctEmotion: { en: 'Happy', hi: 'खुश', emoji: '😊' },
    alternateEmotions: ['Surprised', 'Relieved', 'Excited'],
    explanation_en: 'A friendly smile makes us feel happy.',
    explanation_hi: 'दोस्त की मुस्कान देखकर खुशी होती है।',
  },
  {
    id: 'easy_8',
    level: 'easy',
    en: 'Someone gave you a birthday card.',
    hi: 'किसी ने तुम्हें जन्मदिन का कार्ड दिया।',
    correctEmotion: { en: 'Surprised', hi: 'हैरान', emoji: '😲' },
    alternateEmotions: ['Happy', 'Grateful', 'Excited'],
    explanation_en: 'Something we did not expect gives us a surprise.',
    explanation_hi: 'जिसकी उम्मीद न हो, वह मिलने पर हैरानी होती है।',
  },
  {
    id: 'easy_9',
    level: 'easy',
    en: 'You finished all your homework by yourself.',
    hi: 'आज तुमने अपना पूरा होमवर्क खुद किया।',
    correctEmotion: { en: 'Proud', hi: 'गर्वित', emoji: '😄' },
    alternateEmotions: ['Relieved', 'Happy', 'Excited'],
    explanation_en: 'Finishing something on our own makes us proud.',
    explanation_hi: 'अपना काम खुद पूरा करने पर गर्व महसूस होता है।',
  },
  {
    id: 'easy_10',
    level: 'easy',
    en: 'Your younger sibling gave you a big hug.',
    hi: 'तुम्हारे छोटे भाई या बहन ने तुम्हें प्यार से गले लगाया।',
    correctEmotion: { en: 'Loved', hi: 'प्यार महसूस हुआ', emoji: '🥰' },
    alternateEmotions: ['Happy', 'Surprised', 'Warm'],
    explanation_en: 'A warm hug tells us that someone loves us.',
    explanation_hi: 'प्यार से गले लगाने पर महसूस होता है कि कोई हमें चाहता है।',
  },
  {
    id: 'mod_11',
    level: 'moderate',
    en: 'You studied hard, but your marks were lower than you expected.',
    hi: 'तुमने बहुत मेहनत से पढ़ाई की, लेकिन नंबर उम्मीद से कम आए।',
    correctEmotion: { en: 'Disappointed', hi: 'निराश', emoji: '😞' },
    alternateEmotions: ['Sad', 'Angry', 'Frustrated'],
    explanation_en: 'When the result does not match our effort, we feel disappointed.',
    explanation_hi: 'मेहनत के बावजूद नतीजा उम्मीद जैसा न हो तो निराशा होती है।',
  },
  {
    id: 'mod_12',
    level: 'moderate',
    en: 'Your best friend spent the whole day playing with someone else.',
    hi: 'आज तुम्हारा सबसे अच्छा दोस्त पूरे दिन किसी और के साथ खेलता रहा।',
    correctEmotion: { en: 'Jealous', hi: 'जलन महसूस हुई', emoji: '😒' },
    alternateEmotions: ['Sad', 'Lonely', 'Angry'],
    explanation_en: 'Seeing a close friend with someone else can make us feel jealous.',
    explanation_hi: 'अपने खास दोस्त को किसी और के साथ देखकर जलन महसूस हो सकती है।',
  },
  {
    id: 'mod_13',
    level: 'moderate',
    en: 'You accidentally broke a classroom item.',
    hi: 'तुमसे गलती से क्लास की एक चीज़ टूट गई।',
    correctEmotion: { en: 'Guilty', hi: 'दोषी महसूस हुआ', emoji: '😔' },
    alternateEmotions: ['Scared', 'Embarrassed', 'Worried'],
    explanation_en: 'When our mistake causes damage, we feel guilty.',
    explanation_hi: 'अपनी गलती से नुकसान होने पर दोषी महसूस होता है।',
  },
  {
    id: 'mod_14',
    level: 'moderate',
    en: 'Your classmates started a game without calling you.',
    hi: 'तुम्हारे दोस्त खेल शुरू कर चुके थे, लेकिन उन्होंने तुम्हें नहीं बुलाया।',
    correctEmotion: { en: 'Left out', hi: 'अकेला महसूस हुआ', emoji: '😢' },
    alternateEmotions: ['Sad', 'Angry', 'Hurt'],
    explanation_en: 'Not being included makes us feel left out.',
    explanation_hi: 'जब हमें शामिल नहीं किया जाता, तो अकेलापन महसूस होता है।',
  },
  {
    id: 'mod_15',
    level: 'moderate',
    en: 'You forgot to bring your homework to school.',
    hi: 'तुम अपना होमवर्क घर पर ही भूल आए।',
    correctEmotion: { en: 'Anxious', hi: 'चिंतित', emoji: '😟' },
    alternateEmotions: ['Embarrassed', 'Scared', 'Worried'],
    explanation_en: 'Not being ready for class makes us anxious about what will happen.',
    explanation_hi: 'क्लास के लिए तैयार न होने पर आगे क्या होगा, इसकी चिंता होती है।',
  },
  {
    id: 'mod_16',
    level: 'moderate',
    en: 'The teacher corrected your mistake in front of the whole class.',
    hi: 'टीचर ने पूरी क्लास के सामने तुम्हारी गलती बताई।',
    correctEmotion: { en: 'Embarrassed', hi: 'शर्मिंदा', emoji: '😳' },
    alternateEmotions: ['Angry', 'Sad', 'Humiliated'],
    explanation_en: 'Having our mistake pointed out publicly feels embarrassing.',
    explanation_hi: 'सबके सामने गलती बताई जाए तो शर्मिंदगी होती है।',
  },
  {
    id: 'mod_17',
    level: 'moderate',
    en: "Your team lost today's match.",
    hi: 'आज तुम्हारी टीम मैच हार गई।',
    correctEmotion: { en: 'Disappointed', hi: 'निराश', emoji: '😞' },
    alternateEmotions: ['Sad', 'Angry', 'Frustrated'],
    explanation_en: 'Losing after trying hard leaves us disappointed.',
    explanation_hi: 'कोशिश के बाद हार जाने पर निराशा होती है।',
  },
  {
    id: 'mod_18',
    level: 'moderate',
    en: 'Some children laughed when you made a mistake.',
    hi: 'जब तुमसे गलती हुई तो कुछ बच्चे हँसने लगे।',
    correctEmotion: { en: 'Humiliated', hi: 'बेइज़्ज़ती महसूस हुई', emoji: '😢' },
    alternateEmotions: ['Angry', 'Embarrassed', 'Sad'],
    explanation_en: 'Being laughed at in front of others feels humiliating.',
    explanation_hi: 'सबके सामने हँसी उड़ाई जाए तो बेइज़्ज़ती महसूस होती है।',
  },
  {
    id: 'mod_19',
    level: 'moderate',
    en: 'Your drawing was not selected for the school display.',
    hi: 'तुम्हारी बनाई हुई ड्राइंग चुनी नहीं गई।',
    correctEmotion: { en: 'Disappointed', hi: 'निराश', emoji: '😞' },
    alternateEmotions: ['Sad', 'Jealous', 'Hurt'],
    explanation_en: 'When our work is not chosen, we feel disappointed.',
    explanation_hi: 'अपनी बनाई चीज़ न चुने जाने पर निराशा होती है।',
  },
  {
    id: 'mod_20',
    level: 'moderate',
    en: 'Tomorrow you have to speak on stage in front of everyone.',
    hi: 'कल तुम्हें सबके सामने स्टेज पर बोलना है।',
    correctEmotion: { en: 'Nervous', hi: 'घबराया हुआ', emoji: '😰' },
    alternateEmotions: ['Excited', 'Scared', 'Worried'],
    explanation_en: 'Thinking about facing a crowd makes us nervous.',
    explanation_hi: 'सबके सामने बोलने की सोचकर घबराहट होती है।',
  },
  {
    id: 'adv_21',
    level: 'advanced',
    en: 'Your friend told your secret to everyone.',
    hi: 'तुम्हारे दोस्त ने तुम्हारी बात सबको बता दी।',
    correctEmotion: { en: 'Betrayed', hi: 'धोखा महसूस हुआ', emoji: '😤' },
    alternateEmotions: ['Angry', 'Hurt', 'Sad'],
    explanation_en: 'When someone we trusted breaks that trust, we feel betrayed.',
    explanation_hi: 'जिस पर भरोसा किया वही भरोसा तोड़े, तो धोखा महसूस होता है।',
  },
  {
    id: 'adv_22',
    level: 'advanced',
    en: 'You saw some children making fun of another child.',
    hi: 'तुमने देखा कि कुछ बच्चे एक बच्चे को चिढ़ा रहे थे।',
    correctEmotion: { en: 'Troubled', hi: 'परेशान', emoji: '😟' },
    alternateEmotions: ['Angry', 'Sad', 'Helpless'],
    explanation_en: 'Watching someone being hurt leaves us troubled inside.',
    explanation_hi: 'किसी को दुखी होते देखकर मन परेशान हो जाता है।',
  },
  {
    id: 'adv_23',
    level: 'advanced',
    en: 'You worked very hard but still failed.',
    hi: 'तुमने बहुत मेहनत की, फिर भी सफल नहीं हो पाए।',
    correctEmotion: { en: 'Hopeless', hi: 'निराश और हताश', emoji: '😔' },
    alternateEmotions: ['Sad', 'Angry', 'Disappointed'],
    explanation_en: 'Repeated failure despite effort can make us feel hopeless.',
    explanation_hi: 'मेहनत के बाद भी बार-बार असफलता मिले तो मन हताश हो जाता है।',
  },
  {
    id: 'adv_24',
    level: 'advanced',
    en: 'Your parents had a big argument at home.',
    hi: 'घर पर मम्मी और पापा की ज़ोर से लड़ाई हो गई।',
    correctEmotion: { en: 'Scared', hi: 'डरा हुआ', emoji: '😨' },
    alternateEmotions: ['Worried', 'Sad', 'Helpless'],
    explanation_en: 'Loud fights at home can make a child feel scared.',
    explanation_hi: 'घर में ज़ोर की लड़ाई से बच्चा डर जाता है।',
  },
  {
    id: 'adv_25',
    level: 'advanced',
    en: 'Someone started spreading wrong things about you in school.',
    hi: 'स्कूल में किसी ने तुम्हारे बारे में गलत बातें फैलानी शुरू कर दीं।',
    correctEmotion: { en: 'Hurt', hi: 'दिल दुखा', emoji: '💔' },
    alternateEmotions: ['Angry', 'Embarrassed', 'Betrayed'],
    explanation_en: 'False things said about us hurt our feelings deeply.',
    explanation_hi: 'हमारे बारे में गलत बातें सुनकर दिल दुखता है।',
  },
  {
    id: 'adv_26',
    level: 'advanced',
    en: 'Your best friend is moving to another city.',
    hi: 'तुम्हारा सबसे अच्छा दोस्त किसी दूसरे शहर जा रहा है।',
    correctEmotion: { en: 'Sad', hi: 'दुखी', emoji: '😢' },
    alternateEmotions: ['Lonely', 'Worried', 'Helpless'],
    explanation_en: 'Saying goodbye to someone close makes us sad.',
    explanation_hi: 'किसी अपने से बिछड़ने पर दुख होता है।',
  },
  {
    id: 'adv_27',
    level: 'advanced',
    en: "You said something that hurt your friend's feelings.",
    hi: 'तुमसे ऐसी बात हो गई जिससे तुम्हारे दोस्त को बुरा लग गया।',
    correctEmotion: { en: 'Guilty', hi: 'दोषी महसूस हुआ', emoji: '😔' },
    alternateEmotions: ['Embarrassed', 'Sad', 'Worried'],
    explanation_en: 'Knowing our words hurt someone makes us feel guilty.',
    explanation_hi: 'अपनी बात से किसी को दुख पहुँचे तो दोषी महसूस होता है।',
  },
  {
    id: 'adv_28',
    level: 'advanced',
    en: 'You saw a child sitting alone and crying.',
    hi: 'तुमने देखा कि एक बच्चा अकेला बैठकर रो रहा है।',
    correctEmotion: { en: 'Concerned', hi: 'चिंतित और दयालु', emoji: '🥺' },
    alternateEmotions: ['Sad', 'Helpless', 'Troubled'],
    explanation_en: 'Seeing someone in pain makes us concerned and caring.',
    explanation_hi: 'किसी को दुखी देखकर मन में चिंता और दया आती है।',
  },
  {
    id: 'adv_29',
    level: 'advanced',
    en: 'Your partner did not help with the project, so you did all the work alone.',
    hi: 'तुम्हारे साथी ने प्रोजेक्ट में कोई मदद नहीं की, इसलिए सारा काम तुम्हें अकेले करना पड़ा।',
    correctEmotion: { en: 'Resentful', hi: 'मन में नाराज़गी', emoji: '😒' },
    alternateEmotions: ['Angry', 'Frustrated', 'Tired'],
    explanation_en: "Doing someone else's share builds quiet resentment.",
    explanation_hi: 'किसी और का काम भी खुद करना पड़े तो मन में नाराज़गी भर जाती है।',
  },
  {
    id: 'adv_30',
    level: 'advanced',
    en: 'Your teacher told you how you could improve your work.',
    hi: 'टीचर ने तुम्हें बताया कि अपना काम और अच्छा कैसे कर सकते हो।',
    correctEmotion: { en: 'Motivated', hi: 'उत्साहित', emoji: '💪' },
    alternateEmotions: ['Relieved', 'Grateful', 'Hopeful'],
    explanation_en: 'Helpful feedback shows us a way forward and motivates us.',
    explanation_hi: 'अच्छी सलाह मिलने पर आगे बढ़ने का रास्ता दिखता है और उत्साह आता है।',
  },
]

const LEVEL_ORDER: Level[] = ['easy', 'moderate', 'advanced']

const LEVEL_BADGE: Record<Level, { bg: string; color: string; label: string }> = {
  easy: { bg: '#e8f5ee', color: '#1a6e40', label: 'Easy' },
  moderate: { bg: '#fef9e7', color: '#8a6010', label: 'Moderate' },
  advanced: { bg: '#faeee7', color: '#8a3010', label: 'Advanced' },
}

const FACILITATOR_QS: { en: string; hi: string }[] = [
  { en: 'How do you think this child is feeling?', hi: 'तुम्हें क्या लगता है, यह बच्चा कैसा महसूस कर रहा होगा?' },
  { en: 'Why do you think they feel this way?', hi: 'तुम्हें ऐसा क्यों लगता है?' },
  { en: 'If you were there, what would you do?', hi: 'अगर तुम वहाँ होते, तो क्या करते?' },
  { en: 'Have you ever felt like this?', hi: 'क्या तुम्हारे साथ भी कभी ऐसा हुआ है?' },
]

const NUNITO = "'Nunito', sans-serif"
const DEVANAGARI = "'Noto Sans Devanagari', 'Nunito', sans-serif"
const CONFETTI_COLORS = ['#4caf86', '#ffd700', '#ff6b9d', '#74b9ff', '#fd79a8', '#a29bfe']

const scenariosFor = (level: Level) => SCENARIOS.filter((s) => s.level === level)

/* Illustrated-scene tags — one per scenario id, mirroring Story Choice
   Adventure's SCENE_META side-map so the 30 scenario objects stay untouched.
   `pose` here is the pre-answer resting pose; after the child answers, the
   character transitions to the pose that matches the correct emotion. */
const ED_SCENE_META: Record<string, SceneMeta> = {
  easy_1: { verb: 'social', setting: 'canteen', pose: 'happy', shirt: '#4a7c6f', friendShirt: '#e08a3c', bubble: 'YUM!' },
  easy_2: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  easy_3: { verb: 'achievement', setting: 'classroom', pose: 'happy', shirt: '#3d84c6', bubble: 'YAY!!' },
  easy_4: { verb: 'spill', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', object: 'bottle', bubble: 'OOPS!!' },
  easy_5: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#6b5ce7', bubble: 'HMM...' },
  easy_6: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  easy_7: { verb: 'social', setting: 'playground', pose: 'happy', shirt: '#4a7c6f', friendShirt: '#f0b400', bubble: 'HI!' },
  easy_8: { verb: 'social', setting: 'home', pose: 'surprised', shirt: '#4a7c6f', friendShirt: '#d95c7a', bubble: 'OH!' },
  easy_9: { verb: 'achievement', setting: 'home', pose: 'happy', shirt: '#4a7c6f', bubble: 'WOOHOO!' },
  easy_10: { verb: 'social', setting: 'home', pose: 'happy', shirt: '#4a7c6f', friendShirt: '#f0b400', bubble: 'AWW!' },
  mod_11: { verb: 'waiting', setting: 'classroom', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_12: { verb: 'waiting', setting: 'playground', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_13: { verb: 'accident', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', object: 'cup', bubble: 'UH OH...' },
  mod_14: { verb: 'waiting', setting: 'playground', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_15: { verb: 'accident', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', object: 'book', bubble: 'UH OH...' },
  mod_16: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_17: { verb: 'waiting', setting: 'playground', pose: 'sad', shirt: '#c0504a', bubble: 'OH NO...' },
  mod_18: { verb: 'waiting', setting: 'classroom', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_19: { verb: 'waiting', setting: 'classroom', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  mod_20: { verb: 'waiting', setting: 'hallway', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_21: { verb: 'waiting', setting: 'hallway', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_22: { verb: 'waiting', setting: 'playground', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_23: { verb: 'waiting', setting: 'home', pose: 'sad', shirt: '#4a7c6f', bubble: 'OH NO...' },
  adv_24: { verb: 'waiting', setting: 'home', pose: 'surprised', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_25: { verb: 'waiting', setting: 'hallway', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_26: { verb: 'waiting', setting: 'home', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_27: { verb: 'waiting', setting: 'classroom', pose: 'sad', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_28: { verb: 'waiting', setting: 'hallway', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_29: { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' },
  adv_30: { verb: 'achievement', setting: 'classroom', pose: 'happy', shirt: '#4a7c6f', bubble: 'YAY!!' },
}

const DEFAULT_SCENE_META: SceneMeta = { verb: 'waiting', setting: 'classroom', pose: 'worried', shirt: '#4a7c6f', bubble: 'HMM...' }

// Map a correct-emotion label to the closest available character pose, so the
// illustration reinforces the emotion after the child answers.
const EMOTION_POSE: Record<string, Pose> = {
  Happy: 'happy', Proud: 'happy', Loved: 'happy', Excited: 'happy', Grateful: 'happy',
  Relieved: 'happy', Warm: 'happy', Motivated: 'happy', Hopeful: 'happy',
  Surprised: 'surprised', Scared: 'surprised',
  Sad: 'sad', Disappointed: 'sad', Hurt: 'sad', Lonely: 'sad', 'Left out': 'sad',
  Hopeless: 'sad', Guilty: 'sad', Humiliated: 'sad', Tired: 'sad',
}
const poseForEmotion = (name: string): Pose => EMOTION_POSE[name] ?? 'worried'

// Deterministic shuffle: both participants must see the picker in the SAME order,
// so the seed is the scenario id rather than Math.random(). Order still varies
// from scenario to scenario, which is what keeps the answer position unpredictable.
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let s = h >>> 0
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  const b = [...arr]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

export default function EmotionDetective({ sessionId, role, isLocked }: EmotionDetectiveProps) {
  const isT = role === 'therapist'
  const canInteract = isT || !isLocked

  const [scenarioId, setScenarioId] = useState('easy_1')
  const [selected, setSelected] = useState<string | null>(null)
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState<Level>('easy')
  const [language, setLanguage] = useState<Lang>('both')
  const [revealed, setRevealed] = useState(false)
  const [levelComplete, setLevelComplete] = useState(false)
  const [confetti, setConfetti] = useState<string | null>(null)
  // Therapist-only, private facilitator popover toggle — local, not synced.
  const [facOpen, setFacOpen] = useState(false)

  const prevSelected = useRef<string | null>(null)
  const confettiTimer = useRef<ReturnType<typeof setTimeout>>()

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.edCurrentScenarioId === 'string') setScenarioId(s.edCurrentScenarioId)
      if (s.edSelectedEmotion === null || typeof s.edSelectedEmotion === 'string') setSelected(s.edSelectedEmotion)
      if (typeof s.edScore === 'number') setScore(s.edScore)
      if (s.edLevel === 'easy' || s.edLevel === 'moderate' || s.edLevel === 'advanced') setLevel(s.edLevel)
      if (s.edLanguage === 'en' || s.edLanguage === 'hi' || s.edLanguage === 'both') setLanguage(s.edLanguage)
      if (typeof s.edAnswerRevealed === 'boolean') setRevealed(s.edAnswerRevealed)
      if (typeof s.edLevelComplete === 'boolean') setLevelComplete(s.edLevelComplete)
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => () => { if (confettiTimer.current) clearTimeout(confettiTimer.current) }, [])

  const levelScenarios = useMemo(() => scenariosFor(level), [level])
  const scenario = useMemo(
    () => levelScenarios.find((s) => s.id === scenarioId) ?? levelScenarios[0],
    [levelScenarios, scenarioId]
  )
  const idx = levelScenarios.findIndex((s) => s.id === scenario.id)
  const isLast = idx === levelScenarios.length - 1

  const options = useMemo(() => {
    const pool: Emotion[] = [
      scenario.correctEmotion,
      ...scenario.alternateEmotions.map((n) => EMOTION_POOL[n] ?? { en: n, hi: n, emoji: '❓' }),
    ]
    return seededShuffle(pool, scenario.id)
  }, [scenario])

  const isCorrectPick = selected === scenario.correctEmotion.en

  // Scene metadata for the illustrated scene. After the answer is revealed, the
  // character transitions to the pose matching the correct emotion.
  const sceneMeta: SceneMeta = useMemo(() => {
    const base = ED_SCENE_META[scenario.id] ?? DEFAULT_SCENE_META
    return revealed ? { ...base, pose: poseForEmotion(scenario.correctEmotion.en) } : base
  }, [scenario, revealed])

  // Fire confetti when the selection lands on the correct emotion — driven by synced
  // state so the therapist sees the same celebration the child does.
  useEffect(() => {
    if (selected && selected !== prevSelected.current && selected === scenario.correctEmotion.en) {
      setConfetti(`${scenario.id}-${selected}`)
      if (confettiTimer.current) clearTimeout(confettiTimer.current)
      confettiTimer.current = setTimeout(() => setConfetti(null), 900)
    }
    prevSelected.current = selected
  }, [selected, scenario])

  const showEn = language === 'en' || language === 'both'
  const showHi = language === 'hi' || language === 'both'

  const handleSelect = useCallback((emotion: Emotion) => {
    if (isLocked && !isT) return
    if (selected) return
    const isCorrect = emotion.en === scenario.correctEmotion.en
    const payload: Record<string, unknown> = {
      'moduleState.edSelectedEmotion': emotion.en,
      'moduleState.edAnswerRevealed': true,
      'moduleState.edSessionAnswers': arrayUnion({
        scenarioId: scenario.id,
        selectedEmotion: emotion.en,
        isCorrect,
      }),
    }
    if (isCorrect) payload['moduleState.edScore'] = increment(1)
    write(payload)
    logModuleEvent(sessionId, {
      module: 'emotion-detective',
      type: 'emotion_identified',
      detail: `${scenario.id} (${level}): picked "${emotion.en}" — ${isCorrect ? 'correct' : `expected "${scenario.correctEmotion.en}"`}. "${scenario.en}"`,
    })
  }, [isLocked, isT, selected, scenario, level, write, sessionId])

  const handleNext = useCallback(() => {
    if (!isT) return
    if (isLast) {
      write({ 'moduleState.edLevelComplete': true })
      logModuleEvent(sessionId, {
        module: 'emotion-detective',
        type: 'level_completed',
        detail: `Completed ${level} level with score ${score}/${levelScenarios.length}.`,
      })
      return
    }
    write({
      'moduleState.edCurrentScenarioId': levelScenarios[idx + 1].id,
      'moduleState.edSelectedEmotion': null,
      'moduleState.edAnswerRevealed': false,
    })
  }, [isT, isLast, idx, levelScenarios, write, sessionId, level, score])

  const startLevel = useCallback((next: Level) => {
    if (!isT) return
    write({
      'moduleState.edLevel': next,
      'moduleState.edCurrentScenarioId': scenariosFor(next)[0].id,
      'moduleState.edSelectedEmotion': null,
      'moduleState.edAnswerRevealed': false,
      'moduleState.edScore': 0,
      'moduleState.edLevelComplete': false,
    })
  }, [isT, write])

  const nextLevel = LEVEL_ORDER[LEVEL_ORDER.indexOf(level) + 1] as Level | undefined

  const scoreBand = useMemo(() => {
    if (score >= 8) return { color: '#4caf86', msg: 'Excellent detective work!', icon: '🏆' }
    if (score >= 5) return { color: '#f0c030', msg: 'Good effort!', icon: '👍' }
    return { color: '#c8602a', msg: 'Keep practising!', icon: '💪' }
  }, [score])

  const badge = LEVEL_BADGE[level]
  const ghostBtn = {
    width: '100%', padding: '7px 0', borderRadius: 50, cursor: 'pointer', fontSize: 14, fontFamily: NUNITO, fontWeight: 700,
    background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.6)',
  } as const

  return (
    <>
      <style>{`
        @keyframes edDetectiveBounce {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        @keyframes edConfetti {
          0%   { transform: translate(0, 0) scale(1); opacity: 1; }
          100% { transform: translate(var(--edx), var(--edy)) scale(0.6); opacity: 0; }
        }
        @keyframes edCheerBounce {
          0%, 100% { transform: translateY(0) scale(1); }
          50%      { transform: translateY(-8px) scale(1.06); }
        }
      `}</style>

      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'safe center',
          minHeight: '100%', width: '100%', overflowY: 'auto', color: '#fff', fontFamily: NUNITO, padding: '12px 0',
        }}
      >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%', maxWidth: 760, padding: 24 }}>
        {/* 1 — Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
          <span style={{ flexShrink: 0, background: badge.bg, color: badge.color, fontSize: 13, fontWeight: 800, padding: '3px 9px', borderRadius: 999 }}>
            {badge.label}
          </span>
          <span style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>
            Emotion Detective
          </span>
          {isT ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: 2 }}>
                {([['en', 'EN'], ['hi', 'हिं'], ['both', 'Both']] as [Lang, string][]).map(([key, txt]) => (
                  <button
                    key={key}
                    onClick={() => write({ 'moduleState.edLanguage': key })}
                    style={{
                      border: 'none', cursor: 'pointer', borderRadius: 999, padding: '3px 7px', fontSize: 13, fontWeight: 800,
                      fontFamily: key === 'hi' ? DEVANAGARI : NUNITO,
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
                  flex: 1, padding: '4px 0', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 800,
                  textTransform: 'capitalize', fontFamily: NUNITO,
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
          <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}>
            {levelComplete ? levelScenarios.length : idx + 1}/{levelScenarios.length}
          </span>
        </div>

        <AnimatePresence mode="wait">
          {levelComplete ? (
            /* Level complete card */
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              style={{
                background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', borderRadius: 18,
                padding: 20, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              }}
            >
              <div style={{ fontSize: 70, lineHeight: 1, animation: 'edCheerBounce 1.6s ease-in-out infinite' }}>🎉</div>
              <div style={{ fontSize: 23.5, fontWeight: 900 }}>Level complete!</div>
              <div style={{ fontSize: 18.5, fontWeight: 700, color: 'rgba(255,255,255,0.8)' }}>
                Score: {score} / {levelScenarios.length}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: scoreBand.color }}>
                {scoreBand.icon} {scoreBand.msg}
              </div>
              {isT && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 6 }}>
                  {nextLevel && (
                    <button
                      onClick={() => startLevel(nextLevel)}
                      style={{
                        width: '100%', padding: '8px 20px', borderRadius: 50, cursor: 'pointer', fontSize: 16,
                        fontWeight: 700, fontFamily: NUNITO,
                        background: 'rgba(74,124,111,0.22)', border: '1px solid rgba(74,124,111,0.45)', color: '#b8d4ce',
                      }}
                    >
                      Next level →
                    </button>
                  )}
                  <button onClick={() => startLevel(level)} style={ghostBtn}>Try this level again</button>
                  <button
                    onClick={() => {
                      write({
                        'moduleState.edLevel': 'easy',
                        'moduleState.edCurrentScenarioId': 'easy_1',
                        'moduleState.edSelectedEmotion': null,
                        'moduleState.edAnswerRevealed': false,
                        'moduleState.edScore': 0,
                        'moduleState.edLevelComplete': false,
                      })
                      logModuleEvent(sessionId, {
                        module: 'emotion-detective',
                        type: 'module_ended',
                        detail: `Therapist ended the module after the ${level} level (score ${score}/${levelScenarios.length}).`,
                      })
                    }}
                    style={{ ...ghostBtn, color: 'rgba(255,255,255,0.4)' }}
                  >
                    End module
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="play" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* 3 — Illustrated scene + caption strip */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={scenario.id}
                  initial={{ opacity: 0, scale: 0.94, y: 18 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: -18 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                  style={{
                    background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)',
                    borderRadius: 18, position: 'relative', overflow: 'hidden',
                  }}
                >
                  <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', alignItems: 'center', gap: 6, zIndex: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#5a4632', background: 'rgba(255,255,255,0.72)', borderRadius: 999, padding: '1px 8px' }}>
                      Scenario {idx + 1}
                    </span>
                    <span style={{ fontSize: 18.5, display: 'inline-block', animation: 'edDetectiveBounce 1.8s ease-in-out infinite' }}>🔍</span>
                  </div>

                  <AnimatedScene meta={sceneMeta} />

                  {/* caption strip — dark, not a bordered card */}
                  <div style={{ padding: 14 }}>
                    {showEn && (
                      <div style={{ fontSize: language === 'both' ? 14 : 15, fontWeight: 700, color: 'rgba(255,255,255,0.92)', lineHeight: 1.4 }}>
                        {scenario.en}
                      </div>
                    )}
                    {language === 'both' && <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '8px 0' }} />}
                    {showHi && (
                      <div style={{
                        fontSize: language === 'both' ? 13 : 14, fontWeight: 600, fontFamily: DEVANAGARI, lineHeight: 1.5,
                        color: language === 'both' ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.92)',
                      }}>
                        {scenario.hi}
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Prompt label — kept, moved below the scene */}
              <div style={{ textAlign: 'center' }}>
                {showEn && (
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>
                    What is this child feeling?
                  </div>
                )}
                {showHi && (
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.5)', fontFamily: DEVANAGARI }}>
                    यह बच्चा कैसा महसूस कर रहा है?
                  </div>
                )}
              </div>

              {/* 4 — Emotion picker grid */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                {options.map((emotion, i) => {
                  const isSel = selected === emotion.en
                  const isTheAnswer = emotion.en === scenario.correctEmotion.en
                  const selWrong = isSel && !isTheAnswer
                  const dimmed = selected !== null && !isSel
                  const showBurst = confetti !== null && isSel && isTheAnswer

                  let bg = 'rgba(255,255,255,0.07)'
                  let border = '1.5px solid rgba(255,255,255,0.12)'
                  if (isSel && isTheAnswer) {
                    bg = 'rgba(74,124,111,0.30)'
                    border = '2px solid rgba(74,124,111,0.7)'
                  } else if (selWrong) {
                    bg = 'rgba(200,96,42,0.18)'
                    border = '2px solid rgba(200,96,42,0.4)'
                  }

                  return (
                    <motion.div
                      key={`${scenario.id}-${emotion.en}`}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: dimmed ? 0.38 : 1, scale: isSel ? [1, 1.18, 1] : 1 }}
                      transition={
                        isSel
                          ? { duration: 0.4 }
                          : { delay: i * 0.08, type: 'spring', stiffness: 400, damping: 22 }
                      }
                      whileHover={canInteract && !selected ? { scale: 1.05 } : undefined}
                      whileTap={canInteract && !selected ? { scale: 0.97 } : undefined}
                      style={{
                        width: 'calc(50% - 6px)',
                        pointerEvents: !canInteract || dimmed ? 'none' : 'auto',
                        position: 'relative',
                      }}
                    >
                      <button
                        onClick={() => handleSelect(emotion)}
                        disabled={!canInteract || selected !== null}
                        style={{
                          width: '100%', height: 88, borderRadius: 16, background: bg, border,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                          cursor: !canInteract || selected ? 'default' : 'pointer',
                          fontFamily: NUNITO, color: '#fff', padding: '6px 8px', transition: 'background 0.18s, border-color 0.18s',
                        }}
                        onMouseEnter={(e) => {
                          if (!canInteract || selected) return
                          e.currentTarget.style.background = 'rgba(255,255,255,0.13)'
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'
                        }}
                        onMouseLeave={(e) => {
                          if (!canInteract || selected) return
                          e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                        }}
                      >
                        <span style={{ fontSize: 35, lineHeight: 1 }}>{emotion.emoji}</span>
                        {showEn && (
                          <span style={{ fontSize: 16.5, fontWeight: 700, lineHeight: 1.2, textAlign: 'center' }}>{emotion.en}</span>
                        )}
                        {showHi && (
                          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: DEVANAGARI, color: 'rgba(255,255,255,0.55)', lineHeight: 1.2, textAlign: 'center' }}>
                            {emotion.hi}
                          </span>
                        )}
                      </button>

                      {/* ✓ / ✗ badge */}
                      {isSel && (
                        <span
                          style={{
                            position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: isTheAnswer ? '#4caf86' : '#c8602a',
                            color: '#fff', fontSize: 13, fontWeight: 900, lineHeight: 1,
                          }}
                        >
                          {isTheAnswer ? '✓' : '✗'}
                        </span>
                      )}

                      {/* 5 — Confetti burst */}
                      {showBurst && (
                        <div style={{ position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
                          {Array.from({ length: 12 }).map((_, c) => (
                            <span
                              key={c}
                              style={{
                                position: 'absolute', width: 8, height: 8, borderRadius: '50%',
                                background: CONFETTI_COLORS[c % CONFETTI_COLORS.length],
                                '--edx': `${Math.round(-40 + ((c * 83) % 81))}px`,
                                '--edy': `${-60 - ((c * 37) % 61)}px`,
                                animation: `edConfetti 0.7s ease-out ${(c % 6) * 0.03}s forwards`,
                              } as React.CSSProperties}
                            />
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )
                })}
              </div>

              {/* Locked notice */}
              {!canInteract && (
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                  Therapist is controlling
                </div>
              )}

              {/* 6 — Answer reveal */}
              <AnimatePresence>
                {selected && revealed && (
                  <motion.div
                    key={`${scenario.id}-reveal`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div
                      style={{
                        marginTop: 10, background: 'rgba(255,255,255,0.05)',
                        borderLeft: `3px solid ${isCorrectPick ? '#4caf86' : '#c8602a'}`,
                        borderRadius: '0 10px 10px 0', padding: '10px 14px',
                      }}
                    >
                      {isCorrectPick ? (
                        <>
                          {showEn && <div style={{ fontSize: 16, fontWeight: 800, color: '#4caf86' }}>That&apos;s right!</div>}
                          {showHi && <div style={{ fontSize: 16, fontWeight: 700, color: '#4caf86', fontFamily: DEVANAGARI }}>बिल्कुल सही!</div>}
                          <div style={{ fontSize: 17.5, fontWeight: 800, marginTop: 3 }}>
                            {scenario.correctEmotion.emoji}{' '}
                            {showEn && scenario.correctEmotion.en}
                            {language === 'both' && ' · '}
                            {showHi && <span style={{ fontFamily: DEVANAGARI }}>{scenario.correctEmotion.hi}</span>}
                          </div>
                        </>
                      ) : (
                        <>
                          {showEn && <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.45)' }}>The feeling is...</div>}
                          {showHi && <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.45)', fontFamily: DEVANAGARI }}>भावना है...</div>}
                          <div style={{ fontSize: 17.5, fontWeight: 800, marginTop: 3 }}>
                            {scenario.correctEmotion.emoji}{' '}
                            {showEn && scenario.correctEmotion.en}
                            {language === 'both' && ' · '}
                            {showHi && <span style={{ fontFamily: DEVANAGARI }}>{scenario.correctEmotion.hi}</span>}
                          </div>
                          {showEn && <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>Because...</div>}
                          {showHi && <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.45)', fontFamily: DEVANAGARI, marginTop: showEn ? 0 : 6 }}>क्योंकि...</div>}
                          {showEn && <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.8)', lineHeight: 1.45, marginTop: 2 }}>{scenario.explanation_en}</div>}
                          {showHi && <div style={{ fontSize: 14, fontWeight: 600, fontFamily: DEVANAGARI, color: showEn ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.8)', lineHeight: 1.5, marginTop: 2 }}>{scenario.explanation_hi}</div>}
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 8 — Next button */}
              {isT && selected && (
                <button
                  onClick={handleNext}
                  style={{
                    width: '100%', padding: '8px 20px', borderRadius: 50, cursor: 'pointer', fontSize: 16,
                    fontWeight: 700, fontFamily: NUNITO, marginTop: 8,
                    background: 'rgba(74,124,111,0.22)', border: '1px solid rgba(74,124,111,0.45)', color: '#b8d4ce',
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
              <div onClick={() => setFacOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 48 }} />
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
                <div style={{ fontSize: 14, fontWeight: 800, color: '#a99cf0', marginBottom: 6 }}>💬 Ask the child</div>
                <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {FACILITATOR_QS.map((q, i) => (
                    <li key={i} style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>
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
            title="Ask the child"
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
    </>
  )
}
