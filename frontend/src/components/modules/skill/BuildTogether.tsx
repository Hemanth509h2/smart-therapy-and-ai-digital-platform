'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { doc, onSnapshot, updateDoc, increment } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { AnimatePresence, motion } from 'motion/react'

interface BuildTogetherProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Level = 'easy' | 'moderate' | 'advanced'
type Lang = 'en' | 'hi' | 'both'
type MaterialType = 'stone' | 'metal' | 'wood' | 'rope'
type Theme = 'bridge' | 'tower' | 'garden' | 'machine' | 'house'

type Combination = {
  require: Partial<Record<MaterialType, number>>
  forbid?: MaterialType[]
  minPieces?: number
  // `exact` = the counts in `require` must match exactly, nothing else allowed.
  exact?: boolean
  // Positional constraints: slot index 0 is the left-most slot (the lowest slot
  // for column-layout themes such as `tower`).
  positions?: Array<{ slots: number[]; material: MaterialType }>
}

type Scenario = {
  id: string
  level: Level
  title_en: string
  title_hi: string
  theme: Theme
  therapistClue: { en: string; hi: string }
  childClue: {
    en: string
    hi: string
    materialKey: Array<{ material: MaterialType; label_en: string; label_hi: string }>
  }
  materials: Array<{ type: MaterialType; count: number }>
  slotCount: number
  correctCombination: Combination
  facilitatorQuestions: Array<{ en: string; hi: string }>
}

// The four reflection questions are about the *collaboration process* itself, so
// they apply unchanged to every scenario rather than being re-authored 30 times.
const FQ: Array<{ en: string; hi: string }> = [
  { en: "What did you know that your partner didn't?", hi: 'तुम्हें क्या पता था जो तुम्हारे साथी को नहीं पता था?' },
  { en: "What did your partner know that you didn't?", hi: 'तुम्हारे साथी को क्या पता था जो तुम्हें नहीं पता था?' },
  { en: 'What happened when you shared what you knew?', hi: 'जब तुमने अपनी जानकारी बताई तो क्या हुआ?' },
  { en: 'Was it easier to build together or alone? Why?', hi: 'साथ मिलकर बनाना आसान था या अकेले? क्यों?' },
]

const SCENARIOS: Scenario[] = [
  {
    id: 'easy_1', level: 'easy', theme: 'bridge',
    title_en: 'Build a Bridge', title_hi: 'पुल बनाओ',
    therapistClue: {
      en: "This bridge needs to hold a heavy truck. Don't use rope — it's too weak for something this heavy.",
      hi: 'यह पुल एक भारी ट्रक का वज़न सहेगा। रस्सी का इस्तेमाल मत करो — यह इतनी भारी चीज़ के लिए कमज़ोर है।',
    },
    childClue: {
      en: "Here's what each material can hold:", hi: 'हर सामान क्या सह सकता है:',
      materialKey: [
        { material: 'metal', label_en: 'Very heavy things', label_hi: 'बहुत भारी चीज़ें' },
        { material: 'stone', label_en: 'Heavy things', label_hi: 'भारी चीज़ें' },
        { material: 'wood', label_en: 'Light things', label_hi: 'हल्की चीज़ें' },
        { material: 'rope', label_en: 'Very light things only', label_hi: 'सिर्फ बहुत हल्की चीज़ें' },
      ],
    },
    materials: [{ type: 'stone', count: 4 }, { type: 'metal', count: 3 }, { type: 'wood', count: 4 }, { type: 'rope', count: 3 }],
    slotCount: 5,
    correctCombination: { require: { stone: 2, metal: 1 }, forbid: ['rope'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_2', level: 'easy', theme: 'tower',
    title_en: 'Build a Watchtower', title_hi: 'निगरानी मीनार बनाओ',
    therapistClue: {
      en: 'The tower must stand tall in strong wind. Rope will never hold it steady.',
      hi: 'यह मीनार तेज़ हवा में खड़ी रहनी चाहिए। रस्सी इसे कभी स्थिर नहीं रख पाएगी।',
    },
    childClue: {
      en: 'Here is how steady each material stays:', hi: 'हर सामान कितना स्थिर रहता है:',
      materialKey: [
        { material: 'metal', label_en: 'Steady even in storms', label_hi: 'तूफ़ान में भी स्थिर' },
        { material: 'stone', label_en: 'Steady in strong wind', label_hi: 'तेज़ हवा में स्थिर' },
        { material: 'wood', label_en: 'Sways a little', label_hi: 'थोड़ा हिलती है' },
        { material: 'rope', label_en: 'Blows around freely', label_hi: 'हवा में उड़ जाती है' },
      ],
    },
    materials: [{ type: 'stone', count: 4 }, { type: 'metal', count: 3 }, { type: 'wood', count: 4 }, { type: 'rope', count: 3 }],
    slotCount: 5,
    correctCombination: { require: { stone: 2, metal: 2 }, forbid: ['rope'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_3', level: 'easy', theme: 'garden',
    title_en: 'Build a Garden Fence', title_hi: 'बगीचे की बाड़ बनाओ',
    therapistClue: {
      en: 'This fence only needs to keep rabbits out, so it can be light. Metal costs far too much here — leave it out.',
      hi: 'यह बाड़ सिर्फ खरगोशों को रोकनी है, इसलिए हल्की चल जाएगी। यहाँ धातु बहुत महँगी है — इसे मत लगाओ।',
    },
    childClue: {
      en: 'Here is what each material costs and does:', hi: 'हर सामान की कीमत और काम:',
      materialKey: [
        { material: 'wood', label_en: 'Cheap and strong enough', label_hi: 'सस्ती और काफ़ी मज़बूत' },
        { material: 'rope', label_en: 'Cheap but bends easily', label_hi: 'सस्ती पर आसानी से झुक जाती है' },
        { material: 'stone', label_en: 'Strong but very heavy', label_hi: 'मज़बूत पर बहुत भारी' },
        { material: 'metal', label_en: 'Strongest but costly', label_hi: 'सबसे मज़बूत पर महँगी' },
      ],
    },
    materials: [{ type: 'wood', count: 5 }, { type: 'rope', count: 3 }, { type: 'stone', count: 3 }, { type: 'metal', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { wood: 3 }, forbid: ['metal'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_4', level: 'easy', theme: 'house',
    title_en: 'Build a Treehouse Floor', title_hi: 'पेड़ के घर का फ़र्श बनाओ',
    therapistClue: {
      en: 'The branch can only carry light things. Stone will snap it — leave stone out completely.',
      hi: 'यह डाल सिर्फ हल्की चीज़ें सह सकती है। पत्थर से डाल टूट जाएगी — पत्थर बिल्कुल मत लगाओ।',
    },
    childClue: {
      en: 'Here is how heavy each material is:', hi: 'हर सामान कितना भारी है:',
      materialKey: [
        { material: 'wood', label_en: 'Light and firm', label_hi: 'हल्की और मज़बूत' },
        { material: 'rope', label_en: 'Very light, ties things down', label_hi: 'बहुत हल्की, चीज़ें बाँधती है' },
        { material: 'metal', label_en: 'Heavy', label_hi: 'भारी' },
        { material: 'stone', label_en: 'Very heavy', label_hi: 'बहुत भारी' },
      ],
    },
    materials: [{ type: 'wood', count: 5 }, { type: 'rope', count: 4 }, { type: 'metal', count: 2 }, { type: 'stone', count: 3 }],
    slotCount: 5,
    correctCombination: { require: { wood: 3, rope: 1 }, forbid: ['stone'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_5', level: 'easy', theme: 'machine',
    title_en: 'Build a Dam Gate', title_hi: 'बाँध का दरवाज़ा बनाओ',
    therapistClue: {
      en: 'This gate holds back water all day long. Wood swells and rots in water — do not use it.',
      hi: 'यह दरवाज़ा दिन भर पानी रोकेगा। लकड़ी पानी में फूलकर सड़ जाती है — इसका इस्तेमाल मत करो।',
    },
    childClue: {
      en: 'Here is how each material behaves in water:', hi: 'पानी में हर सामान का हाल:',
      materialKey: [
        { material: 'metal', label_en: 'Never lets water through', label_hi: 'पानी बिल्कुल नहीं जाने देती' },
        { material: 'stone', label_en: 'Blocks water well', label_hi: 'पानी अच्छे से रोकता है' },
        { material: 'wood', label_en: 'Rots in water', label_hi: 'पानी में सड़ जाती है' },
        { material: 'rope', label_en: 'Water flows straight through', label_hi: 'पानी आर-पार बह जाता है' },
      ],
    },
    materials: [{ type: 'stone', count: 4 }, { type: 'metal', count: 3 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { stone: 2, metal: 2 }, forbid: ['wood'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_6', level: 'easy', theme: 'garden',
    title_en: 'Build a Sandcastle Wall', title_hi: 'रेत के किले की दीवार बनाओ',
    therapistClue: {
      en: 'Waves will hit this wall again and again. Anything that floats or washes away is useless here.',
      hi: 'इस दीवार पर बार-बार लहरें टकराएँगी। जो तैर जाए या बह जाए वह यहाँ बेकार है।',
    },
    childClue: {
      en: 'Here is what the waves do to each material:', hi: 'लहरें हर सामान के साथ क्या करती हैं:',
      materialKey: [
        { material: 'stone', label_en: 'Waves cannot move it', label_hi: 'लहरें इसे हिला नहीं सकतीं' },
        { material: 'metal', label_en: 'Heavy, stays put', label_hi: 'भारी, टिकी रहती है' },
        { material: 'wood', label_en: 'Floats away', label_hi: 'तैरकर बह जाती है' },
        { material: 'rope', label_en: 'Washes away at once', label_hi: 'तुरंत बह जाती है' },
      ],
    },
    materials: [{ type: 'stone', count: 5 }, { type: 'metal', count: 3 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { stone: 3 }, forbid: ['rope', 'wood'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_7', level: 'easy', theme: 'house',
    title_en: 'Build a Birdhouse', title_hi: 'चिड़ियों का घर बनाओ',
    therapistClue: {
      en: 'Birds need a warm, light home that hangs from a branch. Stone and metal are far too cold and heavy.',
      hi: 'चिड़ियों को डाल से लटका हुआ गर्म और हल्का घर चाहिए। पत्थर और धातु बहुत ठंडे और भारी हैं।',
    },
    childClue: {
      en: 'Here is how warm and light each material is:', hi: 'हर सामान कितना गर्म और हल्का है:',
      materialKey: [
        { material: 'wood', label_en: 'Warm and light', label_hi: 'गर्म और हल्की' },
        { material: 'rope', label_en: 'Hangs it from the branch', label_hi: 'डाल से लटकाने के लिए' },
        { material: 'metal', label_en: 'Freezing cold in winter', label_hi: 'सर्दी में बर्फ़ जैसी ठंडी' },
        { material: 'stone', label_en: 'Too heavy to hang', label_hi: 'लटकाने के लिए बहुत भारी' },
      ],
    },
    materials: [{ type: 'wood', count: 5 }, { type: 'rope', count: 3 }, { type: 'metal', count: 2 }, { type: 'stone', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { wood: 3, rope: 1 }, forbid: ['stone', 'metal'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_8', level: 'easy', theme: 'machine',
    title_en: 'Build a Swing Set', title_hi: 'झूला बनाओ',
    therapistClue: {
      en: 'The frame must hold a swinging child, and the seat has to hang from something that bends.',
      hi: 'ढाँचा झूलते बच्चे का वज़न सहे, और सीट किसी लचीली चीज़ से लटकनी चाहिए।',
    },
    childClue: {
      en: 'Here is what each material is good for:', hi: 'हर सामान किस काम का है:',
      materialKey: [
        { material: 'metal', label_en: 'A strong frame', label_hi: 'मज़बूत ढाँचा' },
        { material: 'rope', label_en: 'Bends — good for hanging', label_hi: 'लचीली — लटकाने के लिए अच्छी' },
        { material: 'wood', label_en: 'A seat to sit on', label_hi: 'बैठने के लिए सीट' },
        { material: 'stone', label_en: 'Cannot swing at all', label_hi: 'बिल्कुल झूल नहीं सकता' },
      ],
    },
    materials: [{ type: 'metal', count: 3 }, { type: 'rope', count: 3 }, { type: 'wood', count: 4 }, { type: 'stone', count: 3 }],
    slotCount: 5,
    correctCombination: { require: { metal: 2, rope: 2 }, forbid: ['stone'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_9', level: 'easy', theme: 'machine',
    title_en: 'Build a Well', title_hi: 'कुआँ बनाओ',
    therapistClue: {
      en: 'The well wall sits in wet ground for years, and the bucket needs something long to reach the water.',
      hi: 'कुएँ की दीवार सालों तक गीली मिट्टी में रहेगी, और बाल्टी को पानी तक पहुँचने के लिए कुछ लंबा चाहिए।',
    },
    childClue: {
      en: 'Here is how each material lasts underground:', hi: 'ज़मीन के नीचे हर सामान कितना चलता है:',
      materialKey: [
        { material: 'stone', label_en: 'Lasts years in wet ground', label_hi: 'गीली मिट्टी में सालों चलता है' },
        { material: 'rope', label_en: 'Long — lowers the bucket', label_hi: 'लंबी — बाल्टी नीचे भेजती है' },
        { material: 'wood', label_en: 'Rots underground', label_hi: 'ज़मीन के नीचे सड़ जाती है' },
        { material: 'metal', label_en: 'Rusts in water', label_hi: 'पानी में जंग खा जाती है' },
      ],
    },
    materials: [{ type: 'stone', count: 5 }, { type: 'rope', count: 3 }, { type: 'wood', count: 3 }, { type: 'metal', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { stone: 3, rope: 1 }, forbid: ['wood'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_10', level: 'easy', theme: 'garden',
    title_en: 'Build a Garden Pathway', title_hi: 'बगीचे का रास्ता बनाओ',
    therapistClue: {
      en: 'People will walk here in the rain. Anything slippery or soft when wet is a bad idea.',
      hi: 'लोग यहाँ बारिश में चलेंगे। जो गीला होने पर फिसले या नरम हो जाए वह ठीक नहीं।',
    },
    childClue: {
      en: 'Here is how each material feels when wet:', hi: 'गीला होने पर हर सामान कैसा हो जाता है:',
      materialKey: [
        { material: 'stone', label_en: 'Firm even in rain', label_hi: 'बारिश में भी मज़बूत' },
        { material: 'wood', label_en: 'Slippery when wet', label_hi: 'गीली होने पर फिसलन भरी' },
        { material: 'metal', label_en: 'Very slippery in rain', label_hi: 'बारिश में बहुत फिसलन भरी' },
        { material: 'rope', label_en: 'Sinks into the mud', label_hi: 'कीचड़ में धँस जाती है' },
      ],
    },
    materials: [{ type: 'stone', count: 5 }, { type: 'wood', count: 3 }, { type: 'metal', count: 2 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { stone: 4 }, forbid: ['metal', 'rope'], minPieces: 4 },
    facilitatorQuestions: FQ,
  },

  {
    id: 'mod_11', level: 'moderate', theme: 'tower',
    title_en: 'Build a Water Tower', title_hi: 'पानी की टंकी बनाओ',
    therapistClue: {
      en: 'A full tank is enormously heavy, so the legs must be metal. But the platform under it must be wood — metal would rust from the constant drips.',
      hi: 'भरी टंकी बहुत भारी होती है, इसलिए पाए धातु के हों। पर नीचे का चबूतरा लकड़ी का हो — धातु लगातार टपकते पानी से जंग खा जाएगी।',
    },
    childClue: {
      en: 'Use exactly 3 legs and 2 platform pieces — no more, no less:', hi: 'ठीक 3 पाए और 2 चबूतरे के टुकड़े लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'metal', label_en: 'Holds huge weight', label_hi: 'बहुत भारी वज़न सहती है' },
        { material: 'wood', label_en: 'Never rusts', label_hi: 'कभी जंग नहीं खाती' },
        { material: 'stone', label_en: 'Too heavy to lift up high', label_hi: 'इतनी ऊँचाई पर उठाना बहुत भारी' },
        { material: 'rope', label_en: 'Cannot hold a tank', label_hi: 'टंकी नहीं सँभाल सकती' },
      ],
    },
    materials: [{ type: 'metal', count: 4 }, { type: 'wood', count: 4 }, { type: 'stone', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { metal: 3, wood: 2 }, exact: true, forbid: ['rope', 'stone'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_12', level: 'moderate', theme: 'garden',
    title_en: 'Build a Greenhouse', title_hi: 'ग्रीनहाउस बनाओ',
    therapistClue: {
      en: 'Sunlight must reach the plants, so the frame has to be thin metal. The base must be stone to hold the heat in overnight.',
      hi: 'पौधों तक धूप पहुँचनी चाहिए, इसलिए ढाँचा पतली धातु का हो। नीचे का हिस्सा पत्थर का हो ताकि रात भर गर्मी बनी रहे।',
    },
    childClue: {
      en: 'Use exactly 3 frame pieces and 2 base pieces — no more, no less:', hi: 'ठीक 3 ढाँचे के और 2 आधार के टुकड़े लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'metal', label_en: 'Thin — lets light through', label_hi: 'पतली — रोशनी आने देती है' },
        { material: 'stone', label_en: 'Holds heat all night', label_hi: 'रात भर गर्मी रोके रखता है' },
        { material: 'wood', label_en: 'Blocks the sunlight', label_hi: 'धूप रोक देती है' },
        { material: 'rope', label_en: 'Gives no support', label_hi: 'कोई सहारा नहीं देती' },
      ],
    },
    materials: [{ type: 'metal', count: 4 }, { type: 'stone', count: 4 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { metal: 3, stone: 2 }, exact: true, forbid: ['wood', 'rope'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_13', level: 'moderate', theme: 'bridge',
    title_en: 'Build an Aqueduct', title_hi: 'जलसेतु बनाओ',
    therapistClue: {
      en: 'Water must flow along the top without leaking, and the arches below have to carry the whole channel.',
      hi: 'ऊपर से पानी बिना रिसे बहना चाहिए, और नीचे के मेहराब पूरी नाली का भार उठाएँ।',
    },
    childClue: {
      en: 'Use exactly 3 arch pieces and 2 channel pieces — no more, no less:', hi: 'ठीक 3 मेहराब और 2 नाली के टुकड़े लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'stone', label_en: 'Strong arches, no leaks', label_hi: 'मज़बूत मेहराब, रिसाव नहीं' },
        { material: 'metal', label_en: 'Smooth channel for water', label_hi: 'पानी के लिए चिकनी नाली' },
        { material: 'wood', label_en: 'Swells up and leaks', label_hi: 'फूलकर रिसने लगती है' },
        { material: 'rope', label_en: 'Water pours straight through', label_hi: 'पानी सीधा बह जाता है' },
      ],
    },
    materials: [{ type: 'stone', count: 4 }, { type: 'metal', count: 4 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { stone: 3, metal: 2 }, exact: true, forbid: ['wood', 'rope'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_14', level: 'moderate', theme: 'machine',
    title_en: 'Build a Windmill', title_hi: 'पवनचक्की बनाओ',
    therapistClue: {
      en: 'The blades must be light enough for the wind to turn them, but the base must never move at all.',
      hi: 'पंखे इतने हल्के हों कि हवा उन्हें घुमा सके, पर नीचे का आधार बिल्कुल न हिले।',
    },
    childClue: {
      en: 'Use exactly 3 blade pieces and 2 base pieces — no more, no less:', hi: 'ठीक 3 पंखे और 2 आधार के टुकड़े लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'wood', label_en: 'Light blades that spin', label_hi: 'हल्के पंखे जो घूमते हैं' },
        { material: 'stone', label_en: 'A base that never moves', label_hi: 'आधार जो कभी नहीं हिलता' },
        { material: 'metal', label_en: 'Too heavy to spin', label_hi: 'घूमने के लिए बहुत भारी' },
        { material: 'rope', label_en: 'Tangles in the wind', label_hi: 'हवा में उलझ जाती है' },
      ],
    },
    materials: [{ type: 'wood', count: 4 }, { type: 'stone', count: 4 }, { type: 'metal', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { wood: 3, stone: 2 }, exact: true, forbid: ['metal', 'rope'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_15', level: 'moderate', theme: 'bridge',
    title_en: 'Build a Rope Bridge', title_hi: 'रस्सी का पुल बनाओ',
    therapistClue: {
      en: 'This bridge must sway and bend as people walk, so the cables have to be rope. The planks you step on must be wood.',
      hi: 'यह पुल चलते समय झूलेगा और लचकेगा, इसलिए तार रस्सी के हों। जिन पर पैर रखोगे वे तख्ते लकड़ी के हों।',
    },
    childClue: {
      en: 'Use exactly 3 cables and 2 planks — no more, no less:', hi: 'ठीक 3 तार और 2 तख्ते लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'rope', label_en: 'Bends and sways safely', label_hi: 'सुरक्षित रूप से लचकती और झूलती है' },
        { material: 'wood', label_en: 'Flat planks to step on', label_hi: 'पैर रखने के लिए सपाट तख्ते' },
        { material: 'metal', label_en: 'Too stiff — it will snap', label_hi: 'बहुत सख्त — टूट जाएगी' },
        { material: 'stone', label_en: 'Far too heavy to hang', label_hi: 'लटकाने के लिए बहुत ज़्यादा भारी' },
      ],
    },
    materials: [{ type: 'rope', count: 4 }, { type: 'wood', count: 4 }, { type: 'metal', count: 3 }, { type: 'stone', count: 3 }],
    slotCount: 5,
    correctCombination: { require: { rope: 3, wood: 2 }, exact: true, forbid: ['stone', 'metal'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_16', level: 'moderate', theme: 'garden',
    title_en: 'Build an Irrigation Channel', title_hi: 'सिंचाई की नाली बनाओ',
    therapistClue: {
      en: 'Water must reach the field without soaking away, and the sides must not crumble when they get wet.',
      hi: 'पानी बिना ज़मीन में सोखे खेत तक पहुँचे, और गीले होने पर किनारे न ढहें।',
    },
    childClue: {
      en: 'Use exactly 3 side pieces and 2 floor pieces — no more, no less:', hi: 'ठीक 3 किनारे और 2 तल के टुकड़े लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'stone', label_en: 'Sides stay firm when wet', label_hi: 'गीले होने पर भी किनारे मज़बूत' },
        { material: 'metal', label_en: 'Smooth — water runs fast', label_hi: 'चिकनी — पानी तेज़ बहता है' },
        { material: 'wood', label_en: 'Soaks up water and rots', label_hi: 'पानी सोखकर सड़ जाती है' },
        { material: 'rope', label_en: 'Holds no water at all', label_hi: 'पानी बिल्कुल नहीं रोक सकती' },
      ],
    },
    materials: [{ type: 'stone', count: 4 }, { type: 'metal', count: 4 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { stone: 3, metal: 2 }, exact: true, forbid: ['wood', 'rope'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_17', level: 'moderate', theme: 'garden',
    title_en: 'Build a Garden Trellis', title_hi: 'बेल की जाली बनाओ',
    therapistClue: {
      en: 'Climbing plants need something they can grip, and the frame must survive years in direct sun.',
      hi: 'बेलों को पकड़ने के लिए कुछ चाहिए, और ढाँचा सालों तक सीधी धूप में टिका रहे।',
    },
    childClue: {
      en: 'Use exactly 3 frame pieces and 2 climbing lines — no more, no less:', hi: 'ठीक 3 ढाँचे के टुकड़े और 2 चढ़ने की डोरियाँ लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'wood', label_en: 'A frame plants can grip', label_hi: 'ढाँचा जिसे बेल पकड़ सके' },
        { material: 'rope', label_en: 'Vines climb along it', label_hi: 'बेलें इस पर चढ़ती हैं' },
        { material: 'metal', label_en: 'Gets hot and burns the vines', label_hi: 'गर्म होकर बेलें जला देती है' },
        { material: 'stone', label_en: 'Vines cannot climb it', label_hi: 'बेलें इस पर चढ़ नहीं सकतीं' },
      ],
    },
    materials: [{ type: 'wood', count: 4 }, { type: 'rope', count: 4 }, { type: 'metal', count: 3 }, { type: 'stone', count: 3 }],
    slotCount: 5,
    correctCombination: { require: { wood: 3, rope: 2 }, exact: true, forbid: ['metal', 'stone'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_18', level: 'moderate', theme: 'house',
    title_en: 'Build a Rooftop Garden', title_hi: 'छत का बगीचा बनाओ',
    therapistClue: {
      en: 'The roof can only take so much weight, and water must never leak into the room below.',
      hi: 'छत सीमित वज़न ही सह सकती है, और पानी नीचे के कमरे में कभी नहीं रिसना चाहिए।',
    },
    childClue: {
      en: 'Use exactly 3 tray pieces and 2 frame pieces — no more, no less:', hi: 'ठीक 3 तश्तरी और 2 ढाँचे के टुकड़े लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'metal', label_en: 'Thin waterproof tray', label_hi: 'पतली, पानी रोकने वाली तश्तरी' },
        { material: 'wood', label_en: 'Light frame for the beds', label_hi: 'क्यारियों के लिए हल्का ढाँचा' },
        { material: 'stone', label_en: 'Far too heavy for a roof', label_hi: 'छत के लिए बहुत ज़्यादा भारी' },
        { material: 'rope', label_en: 'Cannot hold soil', label_hi: 'मिट्टी नहीं रोक सकती' },
      ],
    },
    materials: [{ type: 'metal', count: 4 }, { type: 'wood', count: 4 }, { type: 'stone', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { metal: 3, wood: 2 }, exact: true, forbid: ['stone', 'rope'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_19', level: 'moderate', theme: 'machine',
    title_en: 'Build a Compost System', title_hi: 'खाद बनाने का डिब्बा बनाओ',
    therapistClue: {
      en: 'Air must reach the waste so it can rot, and the bin must not rust from the wet compost.',
      hi: 'कचरे तक हवा पहुँचनी चाहिए ताकि वह सड़े, और गीली खाद से डिब्बे में जंग न लगे।',
    },
    childClue: {
      en: 'Use exactly 3 wall pieces and 2 floor pieces — no more, no less:', hi: 'ठीक 3 दीवार और 2 फ़र्श के टुकड़े लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'wood', label_en: 'Gaps let the air through', label_hi: 'दरारों से हवा आने देती है' },
        { material: 'stone', label_en: 'Solid floor, never rusts', label_hi: 'पक्का फ़र्श, जंग नहीं लगती' },
        { material: 'metal', label_en: 'Rusts in wet compost', label_hi: 'गीली खाद में जंग खा जाती है' },
        { material: 'rope', label_en: 'Rots away within weeks', label_hi: 'कुछ ही हफ़्तों में सड़ जाती है' },
      ],
    },
    materials: [{ type: 'wood', count: 4 }, { type: 'stone', count: 4 }, { type: 'metal', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { wood: 3, stone: 2 }, exact: true, forbid: ['metal', 'rope'] },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_20', level: 'moderate', theme: 'house',
    title_en: 'Build a Rain Catcher', title_hi: 'बारिश का पानी जमा करो',
    therapistClue: {
      en: 'Rain must slide down a smooth surface into the tank, and the stand must not tip over once it fills.',
      hi: 'बारिश चिकनी सतह से फिसलकर टंकी में जाए, और भरने पर स्टैंड न गिरे।',
    },
    childClue: {
      en: 'Use exactly 3 roof pieces and 2 stand pieces — no more, no less:', hi: 'ठीक 3 छत और 2 स्टैंड के टुकड़े लगाओ — न कम, न ज़्यादा:',
      materialKey: [
        { material: 'metal', label_en: 'Smooth — rain slides off', label_hi: 'चिकनी — बारिश फिसल जाती है' },
        { material: 'stone', label_en: 'Heavy stand, will not tip', label_hi: 'भारी स्टैंड, गिरेगा नहीं' },
        { material: 'wood', label_en: 'Soaks up the rain', label_hi: 'बारिश सोख लेती है' },
        { material: 'rope', label_en: 'Cannot hold a tank', label_hi: 'टंकी नहीं सँभाल सकती' },
      ],
    },
    materials: [{ type: 'metal', count: 4 }, { type: 'stone', count: 4 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: { require: { metal: 3, stone: 2 }, exact: true, forbid: ['wood', 'rope'] },
    facilitatorQuestions: FQ,
  },

  {
    id: 'adv_21', level: 'advanced', theme: 'bridge',
    title_en: 'Build a Suspension Bridge', title_hi: 'झूला पुल बनाओ',
    therapistClue: {
      en: 'The towers at both ends carry the whole bridge. The roadway in the very middle takes the traffic, and cables link the towers to the road.',
      hi: 'दोनों सिरों की मीनारें पूरे पुल का भार उठाती हैं। बीचों-बीच की सड़क पर ट्रैफ़िक चलेगा, और तार मीनारों को सड़क से जोड़ते हैं।',
    },
    childClue: {
      en: 'Where each material belongs:', hi: 'कौन सा सामान कहाँ लगेगा:',
      materialKey: [
        { material: 'stone', label_en: 'Towers — the two outer slots', label_hi: 'मीनारें — दोनों बाहरी खाने' },
        { material: 'rope', label_en: 'Cables — the slots beside the middle', label_hi: 'तार — बीच के बगल वाले खाने' },
        { material: 'metal', label_en: 'Roadway — the middle slot', label_hi: 'सड़क — बीच का खाना' },
        { material: 'wood', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'stone', count: 3 }, { type: 'rope', count: 3 }, { type: 'metal', count: 3 }, { type: 'wood', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { stone: 2, rope: 2, metal: 1 }, exact: true,
      positions: [{ slots: [0, 4], material: 'stone' }, { slots: [1, 3], material: 'rope' }, { slots: [2], material: 'metal' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_22', level: 'advanced', theme: 'tower',
    title_en: 'Build a Multi-Level Tower', title_hi: 'बहुमंज़िला मीनार बनाओ',
    therapistClue: {
      en: 'A tower carries the most weight at the bottom and must be lightest at the very top, or it topples over.',
      hi: 'मीनार का सबसे ज़्यादा भार नीचे होता है और सबसे ऊपर सबसे हल्का होना चाहिए, वरना वह गिर जाती है।',
    },
    childClue: {
      en: 'Where each material belongs (slot 1 is the bottom):', hi: 'कौन सा सामान कहाँ लगेगा (पहला खाना सबसे नीचे):',
      materialKey: [
        { material: 'stone', label_en: 'Foundation — the two bottom slots', label_hi: 'नींव — नीचे के दो खाने' },
        { material: 'metal', label_en: 'Middle floors — the next two slots', label_hi: 'बीच की मंज़िलें — अगले दो खाने' },
        { material: 'wood', label_en: 'Top floor — the highest slot', label_hi: 'सबसे ऊपर की मंज़िल — सबसे ऊँचा खाना' },
        { material: 'rope', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'stone', count: 3 }, { type: 'metal', count: 3 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { stone: 2, metal: 2, wood: 1 }, exact: true,
      positions: [{ slots: [0, 1], material: 'stone' }, { slots: [2, 3], material: 'metal' }, { slots: [4], material: 'wood' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_23', level: 'advanced', theme: 'machine',
    title_en: 'Build a Water Filter', title_hi: 'पानी साफ़ करने का यंत्र बनाओ',
    therapistClue: {
      en: 'Dirty water enters on the left and must pass through a rough layer first, then a fine layer, before clean water leaves on the right.',
      hi: 'गंदा पानी बाईं ओर से आता है और पहले मोटी परत, फिर बारीक परत से गुज़रे, तभी दाईं ओर साफ़ पानी निकलेगा।',
    },
    childClue: {
      en: 'Where each material belongs:', hi: 'कौन सा सामान कहाँ लगेगा:',
      materialKey: [
        { material: 'metal', label_en: 'Inlet pipe — the first slot', label_hi: 'पानी आने की नली — पहला खाना' },
        { material: 'stone', label_en: 'Rough layer — the next two slots', label_hi: 'मोटी परत — अगले दो खाने' },
        { material: 'wood', label_en: 'Fine layer — the last two slots', label_hi: 'बारीक परत — आख़िरी दो खाने' },
        { material: 'rope', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'metal', count: 3 }, { type: 'stone', count: 3 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { metal: 1, stone: 2, wood: 2 }, exact: true,
      positions: [{ slots: [0], material: 'metal' }, { slots: [1, 2], material: 'stone' }, { slots: [3, 4], material: 'wood' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_24', level: 'advanced', theme: 'house',
    title_en: 'Build a Solar Panel Array', title_hi: 'सोलर पैनल लगाओ',
    therapistClue: {
      en: 'The panel sits on a frame that must never rust, on base blocks heavy enough to survive a storm at both ends.',
      hi: 'पैनल ऐसे ढाँचे पर लगे जिसमें कभी जंग न लगे, और दोनों सिरों पर आधार इतना भारी हो कि तूफ़ान में टिका रहे।',
    },
    childClue: {
      en: 'Where each material belongs:', hi: 'कौन सा सामान कहाँ लगेगा:',
      materialKey: [
        { material: 'stone', label_en: 'Base blocks — the two outer slots', label_hi: 'आधार — दोनों बाहरी खाने' },
        { material: 'wood', label_en: 'Frame — the slots beside the middle', label_hi: 'ढाँचा — बीच के बगल वाले खाने' },
        { material: 'metal', label_en: 'Panel — the middle slot', label_hi: 'पैनल — बीच का खाना' },
        { material: 'rope', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'stone', count: 3 }, { type: 'wood', count: 3 }, { type: 'metal', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { stone: 2, wood: 2, metal: 1 }, exact: true,
      positions: [{ slots: [0, 4], material: 'stone' }, { slots: [1, 3], material: 'wood' }, { slots: [2], material: 'metal' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_25', level: 'advanced', theme: 'garden',
    title_en: 'Build a Retaining Wall', title_hi: 'मिट्टी रोकने वाली दीवार बनाओ',
    therapistClue: {
      en: 'This wall holds back a whole hillside. The bottom takes the most pressure, the middle ties the wall together, and the top takes the least.',
      hi: 'यह दीवार पूरी पहाड़ी की मिट्टी रोकेगी। सबसे ज़्यादा दबाव नीचे होता है, बीच का हिस्सा दीवार को बाँधता है, और ऊपर सबसे कम दबाव होता है।',
    },
    childClue: {
      en: 'Where each material belongs (slot 1 is the bottom row):', hi: 'कौन सा सामान कहाँ लगेगा (पहला खाना सबसे नीचे की पंक्ति):',
      materialKey: [
        { material: 'stone', label_en: 'Bottom rows — the two lowest slots', label_hi: 'नीचे की पंक्तियाँ — सबसे नीचे के दो खाने' },
        { material: 'metal', label_en: 'Middle rows — the next two slots', label_hi: 'बीच की पंक्तियाँ — अगले दो खाने' },
        { material: 'wood', label_en: 'Top row — the highest slot', label_hi: 'ऊपर की पंक्ति — सबसे ऊँचा खाना' },
        { material: 'rope', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'stone', count: 3 }, { type: 'metal', count: 3 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { stone: 2, metal: 2, wood: 1 }, exact: true,
      positions: [{ slots: [0, 1], material: 'stone' }, { slots: [2, 3], material: 'metal' }, { slots: [4], material: 'wood' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_26', level: 'advanced', theme: 'machine',
    title_en: 'Build a Drainage System', title_hi: 'पानी निकासी बनाओ',
    therapistClue: {
      en: 'Rainwater enters through a grate, runs along a pipe, and soaks away into a bed of loose stone at the far end.',
      hi: 'बारिश का पानी जाली से आता है, नली से बहता है, और आख़िरी सिरे पर ढीले पत्थरों की तह में सोख जाता है।',
    },
    childClue: {
      en: 'Where each material belongs:', hi: 'कौन सा सामान कहाँ लगेगा:',
      materialKey: [
        { material: 'metal', label_en: 'Grate — the first slot', label_hi: 'जाली — पहला खाना' },
        { material: 'wood', label_en: 'Pipe run — the middle two slots', label_hi: 'नली — बीच के दो खाने' },
        { material: 'stone', label_en: 'Soak bed — the last two slots', label_hi: 'सोखने की तह — आख़िरी दो खाने' },
        { material: 'rope', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'metal', count: 3 }, { type: 'wood', count: 3 }, { type: 'stone', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { metal: 1, wood: 2, stone: 2 }, exact: true,
      positions: [{ slots: [0], material: 'metal' }, { slots: [1, 2], material: 'wood' }, { slots: [3, 4], material: 'stone' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_27', level: 'advanced', theme: 'garden',
    title_en: 'Build a Terrace Garden', title_hi: 'सीढ़ीदार बगीचा बनाओ',
    therapistClue: {
      en: 'Each step holds the soil above the one below it. The lowest steps carry every step above them, and the plants at the top need tying down.',
      hi: 'हर सीढ़ी अपने नीचे वाली पर मिट्टी रोकती है। सबसे नीचे की सीढ़ियाँ ऊपर की सारी सीढ़ियों का भार उठाती हैं, और ऊपर के पौधों को बाँधना पड़ता है।',
    },
    childClue: {
      en: 'Where each material belongs (slot 1 is the lowest step):', hi: 'कौन सा सामान कहाँ लगेगा (पहला खाना सबसे नीचे की सीढ़ी):',
      materialKey: [
        { material: 'stone', label_en: 'Lowest steps — the two bottom slots', label_hi: 'सबसे नीचे की सीढ़ियाँ — नीचे के दो खाने' },
        { material: 'wood', label_en: 'Upper steps — the next two slots', label_hi: 'ऊपर की सीढ़ियाँ — अगले दो खाने' },
        { material: 'rope', label_en: 'Top edge — ties the plants', label_hi: 'सबसे ऊपर — पौधे बाँधने के लिए' },
        { material: 'metal', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'stone', count: 3 }, { type: 'wood', count: 3 }, { type: 'rope', count: 3 }, { type: 'metal', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { stone: 2, wood: 2, rope: 1 }, exact: true,
      positions: [{ slots: [0, 1], material: 'stone' }, { slots: [2, 3], material: 'wood' }, { slots: [4], material: 'rope' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_28', level: 'advanced', theme: 'tower',
    title_en: 'Build a Wind Turbine Base', title_hi: 'पवन टरबाइन का आधार बनाओ',
    therapistClue: {
      en: 'The turbine shakes constantly. The base must be dead heavy, the shaft must never bend, and a guy line holds the very top steady.',
      hi: 'टरबाइन लगातार हिलती है। आधार बहुत भारी हो, खंभा कभी न मुड़े, और सबसे ऊपर एक तार उसे थामे रखे।',
    },
    childClue: {
      en: 'Where each material belongs (slot 1 is the bottom):', hi: 'कौन सा सामान कहाँ लगेगा (पहला खाना सबसे नीचे):',
      materialKey: [
        { material: 'stone', label_en: 'Base — the two lowest slots', label_hi: 'आधार — नीचे के दो खाने' },
        { material: 'metal', label_en: 'Shaft — the middle two slots', label_hi: 'खंभा — बीच के दो खाने' },
        { material: 'rope', label_en: 'Guy line — the top slot', label_hi: 'थामने वाला तार — ऊपर का खाना' },
        { material: 'wood', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'stone', count: 3 }, { type: 'metal', count: 3 }, { type: 'rope', count: 3 }, { type: 'wood', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { stone: 2, metal: 2, rope: 1 }, exact: true,
      positions: [{ slots: [0, 1], material: 'stone' }, { slots: [2, 3], material: 'metal' }, { slots: [4], material: 'rope' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_29', level: 'advanced', theme: 'bridge',
    title_en: 'Build a Flood Barrier', title_hi: 'बाढ़ रोकने वाली दीवार बनाओ',
    therapistClue: {
      en: 'Floodwater pushes hardest at the outer ends where it curves around. The very middle must be sealed so nothing seeps through, with braces behind it on either side.',
      hi: 'बाढ़ का पानी बाहरी सिरों पर सबसे ज़्यादा ज़ोर लगाता है जहाँ वह मुड़ता है। बीच का हिस्सा ऐसा सील हो कि कुछ न रिसे, और उसके दोनों ओर पीछे से टेक लगे।',
    },
    childClue: {
      en: 'Where each material belongs:', hi: 'कौन सा सामान कहाँ लगेगा:',
      materialKey: [
        { material: 'stone', label_en: 'Ends — the two outer slots', label_hi: 'सिरे — दोनों बाहरी खाने' },
        { material: 'wood', label_en: 'Braces — the slots beside the middle', label_hi: 'टेक — बीच के बगल वाले खाने' },
        { material: 'metal', label_en: 'Sealed middle — the centre slot', label_hi: 'सील बंद बीच — बीच का खाना' },
        { material: 'rope', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'stone', count: 3 }, { type: 'wood', count: 3 }, { type: 'metal', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { stone: 2, wood: 2, metal: 1 }, exact: true,
      positions: [{ slots: [0, 4], material: 'stone' }, { slots: [1, 3], material: 'wood' }, { slots: [2], material: 'metal' }],
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_30', level: 'advanced', theme: 'house',
    title_en: 'Build an Observation Deck', title_hi: 'नज़ारा देखने का चबूतरा बनाओ',
    therapistClue: {
      en: 'People stand right at the edges to look out, so the edges must be the safest part. The floor in between must not creak or bend underfoot.',
      hi: 'लोग किनारों पर खड़े होकर नज़ारा देखेंगे, इसलिए किनारे सबसे सुरक्षित हों। बीच का फ़र्श पैरों के नीचे न चरमराए, न झुके।',
    },
    childClue: {
      en: 'Where each material belongs:', hi: 'कौन सा सामान कहाँ लगेगा:',
      materialKey: [
        { material: 'metal', label_en: 'Railings — the two outer slots', label_hi: 'रेलिंग — दोनों बाहरी खाने' },
        { material: 'stone', label_en: 'Supports — the slots beside the middle', label_hi: 'सहारे — बीच के बगल वाले खाने' },
        { material: 'wood', label_en: 'Deck floor — the middle slot', label_hi: 'चबूतरे का फ़र्श — बीच का खाना' },
        { material: 'rope', label_en: 'Not used here', label_hi: 'यहाँ इस्तेमाल नहीं' },
      ],
    },
    materials: [{ type: 'metal', count: 3 }, { type: 'stone', count: 3 }, { type: 'wood', count: 3 }, { type: 'rope', count: 2 }],
    slotCount: 5,
    correctCombination: {
      require: { metal: 2, stone: 2, wood: 1 }, exact: true,
      positions: [{ slots: [0, 4], material: 'metal' }, { slots: [1, 3], material: 'stone' }, { slots: [2], material: 'wood' }],
    },
    facilitatorQuestions: FQ,
  },
]

const LEVEL_ORDER: Level[] = ['easy', 'moderate', 'advanced']

const MATERIAL_LABEL: Record<MaterialType, { en: string; hi: string }> = {
  stone: { en: 'Stone', hi: 'पत्थर' },
  metal: { en: 'Metal', hi: 'धातु' },
  wood: { en: 'Wood', hi: 'लकड़ी' },
  rope: { en: 'Rope', hi: 'रस्सी' },
}

const SWATCH: Record<MaterialType, string> = {
  stone: '#8a8580',
  metal: '#9aa5ac',
  wood: '#a0653a',
  rope: '#a8874f',
}

const THEME_EMOJI: Record<Theme, string> = {
  bridge: '🌉', tower: '🗼', garden: '🌱', machine: '⚙️', house: '🏠',
}

// Themes whose slots stack vertically (slot 0 = bottom) rather than left-to-right.
const COLUMN_THEMES: Theme[] = ['tower']

const NUNITO = "'Nunito', sans-serif"
const DEVANAGARI = "'Noto Sans Devanagari', 'Nunito', sans-serif"
const PARTICLE_COLORS = ['#4caf86', '#ffd700', '#ff6b9d', '#74b9ff', '#c8602a']

const scenariosFor = (level: Level) => SCENARIOS.filter((s) => s.level === level)

function validate(filled: Record<string, string>, c: Combination, slotCount: number): boolean {
  const pieces: MaterialType[] = []
  for (let i = 0; i < slotCount; i++) {
    const v = filled[String(i)]
    if (v) pieces.push(v as MaterialType)
  }
  if (c.forbid && pieces.some((p) => c.forbid!.includes(p))) return false
  if (c.minPieces && pieces.length < c.minPieces) return false

  const counts: Partial<Record<MaterialType, number>> = {}
  for (const p of pieces) counts[p] = (counts[p] || 0) + 1

  for (const [m, n] of Object.entries(c.require) as [MaterialType, number][]) {
    const have = counts[m] || 0
    if (c.exact ? have !== n : have < n) return false
  }
  if (c.exact) {
    const total = Object.values(c.require).reduce<number>((a, b) => a + (b || 0), 0)
    if (pieces.length !== total) return false
    for (const m of Object.keys(counts) as MaterialType[]) if (!(m in c.require)) return false
  }
  if (c.positions) {
    for (const rule of c.positions) {
      for (const s of rule.slots) if (filled[String(s)] !== rule.material) return false
    }
  }
  return true
}

/* ===== Material pieces — CSS/SVG only, each physically distinct ===== */
const PIECE_SHADOW = 'drop-shadow(0 3px 6px rgba(0,0,0,0.25))'

function Piece({ type }: { type: MaterialType }) {
  if (type === 'stone') {
    return (
      <div style={{ position: 'relative', width: 40, height: 32, borderRadius: 4, background: 'linear-gradient(160deg, #a8a29a 0%, #8a8580 55%, #6b6660 100%)', filter: PIECE_SHADOW }}>
        <div style={{ position: 'absolute', top: 4, left: 4, right: 4, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.35)' }} />
        <div style={{ position: 'absolute', bottom: 3, left: 6, width: 14, height: 2, borderRadius: 1, background: 'rgba(0,0,0,0.15)' }} />
      </div>
    )
  }
  if (type === 'metal') {
    return (
      <div style={{ position: 'relative', width: 44, height: 14, borderRadius: 3, overflow: 'hidden', background: 'linear-gradient(180deg, #c4ccd0 0%, #9aa5ac 45%, #707b82 100%)', filter: PIECE_SHADOW }}>
        <div style={{ position: 'absolute', top: 2, left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.6)' }} />
      </div>
    )
  }
  if (type === 'wood') {
    return (
      <div style={{ position: 'relative', width: 42, height: 12, borderRadius: 2, background: 'linear-gradient(180deg, #c08654 0%, #a0653a 50%, #7d4a28 100%)', filter: PIECE_SHADOW }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 8, width: 1, background: 'rgba(0,0,0,0.2)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 22, width: 1, background: 'rgba(0,0,0,0.2)' }} />
      </div>
    )
  }
  return (
    <svg width={46} height={16} viewBox="0 0 46 16" style={{ filter: PIECE_SHADOW, display: 'block' }}>
      <path d="M2 8 Q 23 16 44 8" stroke="#a8874f" strokeWidth={3} fill="none" strokeLinecap="round" />
      <path d="M2 8 Q 23 14 44 8" stroke="#c9a875" strokeWidth={1.5} fill="none" strokeLinecap="round" />
    </svg>
  )
}

/* ===== Scene backdrop — layers 1-5, swapped per theme ===== */
function Clouds() {
  return (
    <>
      {[
        { top: '8%', left: '6%', scale: 1, delay: '0s', dur: '34s' },
        { top: '16%', left: '48%', scale: 0.8, delay: '-12s', dur: '40s' },
        { top: '5%', left: '72%', scale: 0.65, delay: '-24s', dur: '32s' },
      ].map((c, i) => (
        <div key={i} style={{ position: 'absolute', top: c.top, left: c.left, transform: `scale(${c.scale})`, animation: `btDrift ${c.dur} linear ${c.delay} infinite alternate`, opacity: 0.9 }}>
          <div style={{ position: 'relative', width: 90, height: 22, borderRadius: 14, background: 'rgba(255,255,255,0.7)' }}>
            <div style={{ position: 'absolute', top: -14, left: 16, width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.7)' }} />
            <div style={{ position: 'absolute', top: -8, left: 46, width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.7)' }} />
          </div>
        </div>
      ))}
    </>
  )
}

function Hills({ colors }: { colors: [string, string, string] }) {
  return (
    <>
      <div style={{ position: 'absolute', bottom: '34%', left: '-6%', width: '46%', height: 90, borderRadius: '50% 50% 0 0', background: colors[0], opacity: 0.5 }} />
      <div style={{ position: 'absolute', bottom: '34%', left: '28%', width: '52%', height: 120, borderRadius: '50% 50% 0 0', background: colors[1], opacity: 0.6 }} />
      <div style={{ position: 'absolute', bottom: '34%', right: '-8%', width: '44%', height: 80, borderRadius: '50% 50% 0 0', background: colors[2], opacity: 0.55 }} />
    </>
  )
}

function GrassTufts({ side }: { side: 'left' | 'right' }) {
  // 5 tufts scattered along the bank edge — exact approved values
  const tufts = [
    { pct: 10, bottom: 155 },
    { pct: 28, bottom: 147 },
    { pct: 46, bottom: 139 },
    { pct: 64, bottom: 131 },
    { pct: 82, bottom: 123 },
  ]
  return (
    <>
      {tufts.map((t, i) => (
        <div
          key={i}
          style={{
            position: 'absolute', bottom: t.bottom, [side]: `${t.pct}%`, width: 14, height: 20,
            borderRadius: '50% 50% 0 0', background: '#6d9b78', opacity: 0.7,
          } as React.CSSProperties}
        />
      ))}
    </>
  )
}

function SceneBackdrop({ theme }: { theme: Theme }) {
  // Layer 1 — sky (per-theme palette, always a warm daylight scene)
  const sky: Record<Theme, string> = {
    bridge: 'linear-gradient(180deg, #a8d8e8 0%, #d4ecf0 55%, #4a90a4 100%)',
    tower: 'linear-gradient(180deg, #9fcfe4 0%, #e2eef2 58%, #b7a887 100%)',
    garden: 'linear-gradient(180deg, #a9dbe9 0%, #e6f2e2 52%, #7d9c5c 100%)',
    machine: 'linear-gradient(180deg, #b6cddb 0%, #e4ecf1 55%, #96876f 100%)',
    house: 'linear-gradient(180deg, #a5d6ea 0%, #e8f1e6 54%, #8fae72 100%)',
  }

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: sky[theme] }} />
      <Clouds />

      {theme === 'bridge' && (
        <>
          <Hills colors={['#8bb896', '#6d9b78', '#8bb896']} />
          {/* Water */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '35%', background: '#4a90a4' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 30% 40%, rgba(255,255,255,0.5) 0%, transparent 55%), radial-gradient(ellipse at 72% 66%, rgba(255,255,255,0.4) 0%, transparent 50%)', animation: 'btShimmer 4s ease-in-out infinite' }} />
          </div>
          {/* Riverbanks */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: '30%', height: '52%', background: 'linear-gradient(180deg, #c9a66b 0%, #a8874f 100%)', clipPath: 'polygon(0 0, 100% 30%, 100% 100%, 0 100%)' }} />
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: '30%', height: '52%', background: 'linear-gradient(180deg, #c9a66b 0%, #a8874f 100%)', clipPath: 'polygon(0 30%, 100% 0, 100% 100%, 0 100%)' }} />
          <GrassTufts side="left" />
          <GrassTufts side="right" />
          {/* Grounding shadow under the gap */}
          <div style={{ position: 'absolute', bottom: '30%', left: '50%', transform: 'translateX(-50%)', width: 260, height: 40, background: 'radial-gradient(ellipse, rgba(0,0,0,0.22) 0%, transparent 70%)' }} />
        </>
      )}

      {theme === 'tower' && (
        <>
          <Hills colors={['#9a8f6d', '#87805f', '#a89b78']} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '34%', background: 'linear-gradient(180deg, #b7a887 0%, #8f8064 100%)' }} />
          <div style={{ position: 'absolute', bottom: '30%', left: '50%', transform: 'translateX(-50%)', width: 220, height: 34, background: 'radial-gradient(ellipse, rgba(0,0,0,0.22) 0%, transparent 70%)' }} />
          <GrassTufts side="left" />
          <GrassTufts side="right" />
        </>
      )}

      {theme === 'garden' && (
        <>
          <Hills colors={['#8fae72', '#6f8f5f', '#a3bd85']} />
          {/* Soil bed */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '34%', background: 'linear-gradient(180deg, #8b6b45 0%, #6b4f30 100%)' }} />
          <div style={{ position: 'absolute', bottom: '32%', left: 0, right: 0, height: 14, background: 'linear-gradient(180deg, #83a06d 0%, #6f8f5f 100%)', borderRadius: '50% 50% 0 0' }} />
          <div style={{ position: 'absolute', bottom: '30%', left: '50%', transform: 'translateX(-50%)', width: 240, height: 34, background: 'radial-gradient(ellipse, rgba(0,0,0,0.2) 0%, transparent 70%)' }} />
        </>
      )}

      {theme === 'machine' && (
        <>
          <Hills colors={['#9d9a86', '#8a8778', '#a49f8c']} />
          {/* Workshop floor */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '34%', background: 'linear-gradient(180deg, #96876f 0%, #6f6455 100%)' }} />
          {/* Faint gear silhouettes for depth */}
          {[{ left: '14%', size: 70, op: 0.12 }, { left: '78%', size: 54, op: 0.1 }].map((g, i) => (
            <div key={i} style={{ position: 'absolute', bottom: '36%', left: g.left, width: g.size, height: g.size, borderRadius: '50%', border: `8px solid rgba(60,50,40,${g.op})` }} />
          ))}
          <div style={{ position: 'absolute', bottom: '30%', left: '50%', transform: 'translateX(-50%)', width: 240, height: 34, background: 'radial-gradient(ellipse, rgba(0,0,0,0.22) 0%, transparent 70%)' }} />
        </>
      )}

      {theme === 'house' && (
        <>
          <Hills colors={['#8fae72', '#77985f', '#a3bd85']} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '34%', background: 'linear-gradient(180deg, #8fae72 0%, #5f7d4a 100%)' }} />
          <GrassTufts side="left" />
          <GrassTufts side="right" />
          <div style={{ position: 'absolute', bottom: '30%', left: '50%', transform: 'translateX(-50%)', width: 240, height: 34, background: 'radial-gradient(ellipse, rgba(0,0,0,0.2) 0%, transparent 70%)' }} />
        </>
      )}
    </>
  )
}

export default function BuildTogether({ sessionId, role, isLocked }: BuildTogetherProps) {
  const isT = role === 'therapist'
  const canDrag = isT || !isLocked

  const [scenarioId, setScenarioId] = useState('easy_1')
  const [level, setLevel] = useState<Level>('easy')
  const [filled, setFilled] = useState<Record<string, string>>({})
  const [language, setLanguage] = useState<Lang>('both')
  const [completed, setCompleted] = useState(false)
  const [attempts, setAttempts] = useState(0)

  const [dragOver, setDragOver] = useState<number | null>(null)
  const [shake, setShake] = useState(false)
  const [burst, setBurst] = useState(false)
  const [fqOpen, setFqOpen] = useState(true)
  const shakeT = useRef<ReturnType<typeof setTimeout>>()
  const burstT = useRef<ReturnType<typeof setTimeout>>()

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.btCurrentScenarioId === 'string') setScenarioId(s.btCurrentScenarioId)
      if (s.btLevel === 'easy' || s.btLevel === 'moderate' || s.btLevel === 'advanced') setLevel(s.btLevel)
      if (s.btFilledSlots && typeof s.btFilledSlots === 'object') setFilled(s.btFilledSlots as Record<string, string>)
      if (s.btLanguage === 'en' || s.btLanguage === 'hi' || s.btLanguage === 'both') setLanguage(s.btLanguage)
      if (typeof s.btCompleted === 'boolean') setCompleted(s.btCompleted)
      if (typeof s.btAttempts === 'number') setAttempts(s.btAttempts)
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => () => {
    if (shakeT.current) clearTimeout(shakeT.current)
    if (burstT.current) clearTimeout(burstT.current)
  }, [])

  const levelScenarios = useMemo(() => scenariosFor(level), [level])
  const scenario = useMemo(
    () => levelScenarios.find((s) => s.id === scenarioId) ?? levelScenarios[0],
    [levelScenarios, scenarioId]
  )
  const idx = levelScenarios.findIndex((s) => s.id === scenario.id)

  // Celebrate whenever the shared state flips to completed, so BOTH screens play it.
  useEffect(() => {
    if (!completed) { setBurst(false); return }
    setBurst(true)
    if (burstT.current) clearTimeout(burstT.current)
    burstT.current = setTimeout(() => setBurst(false), 3200)
  }, [completed, scenario.id])

  const showEn = language === 'en' || language === 'both'
  const showHi = language === 'hi' || language === 'both'
  const isColumn = COLUMN_THEMES.includes(scenario.theme)

  const used = useMemo(() => {
    const u: Partial<Record<MaterialType, number>> = {}
    for (let i = 0; i < scenario.slotCount; i++) {
      const v = filled[String(i)] as MaterialType | undefined
      if (v) u[v] = (u[v] || 0) + 1
    }
    return u
  }, [filled, scenario.slotCount])

  const handleDrop = useCallback((slotIdx: number, type: string) => {
    if (!canDrag || completed) return
    const mat = scenario.materials.find((m) => m.type === type)
    if (!mat) return
    const alreadyUsed = used[type as MaterialType] || 0
    const isReplacing = filled[String(slotIdx)] === type
    if (!isReplacing && alreadyUsed >= mat.count) return
    write({ 'moduleState.btFilledSlots': { ...filled, [String(slotIdx)]: type } })
  }, [canDrag, completed, scenario.materials, used, filled, write])

  const clearSlot = useCallback((slotIdx: number) => {
    if (!canDrag || completed) return
    const next = { ...filled }
    delete next[String(slotIdx)]
    write({ 'moduleState.btFilledSlots': next })
  }, [canDrag, completed, filled, write])

  const handleCheck = useCallback(() => {
    if (!isT) return
    const ok = validate(filled, scenario.correctCombination, scenario.slotCount)
    if (ok) {
      write({ 'moduleState.btCompleted': true })
      logModuleEvent(sessionId, {
        module: 'build-together',
        type: 'build_completed',
        detail: `${scenario.id} (${level}) "${scenario.title_en}" built correctly after ${attempts} failed check(s).`,
      })
    } else {
      write({ 'moduleState.btAttempts': increment(1) })
      setShake(true)
      if (shakeT.current) clearTimeout(shakeT.current)
      shakeT.current = setTimeout(() => setShake(false), 320)
    }
  }, [isT, filled, scenario, write, sessionId, level, attempts])

  const loadScenario = useCallback((id: string, lvl: Level) => {
    write({
      'moduleState.btCurrentScenarioId': id,
      'moduleState.btLevel': lvl,
      'moduleState.btFilledSlots': {},
      'moduleState.btCompleted': false,
      'moduleState.btAttempts': 0,
    })
  }, [write])

  const handleNext = useCallback(() => {
    if (!isT) return
    if (idx < levelScenarios.length - 1) {
      loadScenario(levelScenarios[idx + 1].id, level)
      return
    }
    const nl = LEVEL_ORDER[LEVEL_ORDER.indexOf(level) + 1]
    if (nl) loadScenario(scenariosFor(nl)[0].id, nl)
    else loadScenario('easy_1', 'easy')
  }, [isT, idx, levelScenarios, level, loadScenario])

  const cardBase: React.CSSProperties = {
    position: 'relative', width: 190, background: 'rgba(255,251,240,0.97)', borderRadius: 14,
    border: '2px solid rgba(139,90,43,0.2)', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
    padding: '10px 12px', fontFamily: NUNITO,
  }

  const myClueIsTherapist = isT

  return (
    <>
      <style>{`
        @keyframes btDrift { 0% { transform: translateX(0); } 100% { transform: translateX(60px); } }
        @keyframes btShimmer { 0%,100% { opacity: 0.35; } 50% { opacity: 0.85; } }
        @keyframes btShake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
        @keyframes btDrive { 0% { left: -60px; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: 110%; opacity: 0; } }
        @keyframes btParticle {
          0% { transform: translate(0,0) scale(1); opacity: 1; }
          100% { transform: translate(var(--btx), var(--bty)) scale(0.4); opacity: 0; }
        }
      `}</style>

      <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 420, overflow: 'hidden', borderRadius: 16, fontFamily: NUNITO }}>
        {/* Layers 1-5 */}
        <SceneBackdrop theme={scenario.theme} />

        {/* Layer 7 — header pill */}
        <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 30, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderRadius: 20,
              background: 'rgba(255,251,240,0.95)', boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
              fontSize: 16, fontWeight: 800, color: '#5a3a1a', whiteSpace: 'nowrap',
            }}
          >
            <span>{THEME_EMOJI[scenario.theme]}</span>
            {showEn && <span>{scenario.title_en}</span>}
            {showHi && <span style={{ fontFamily: DEVANAGARI, fontWeight: 600 }}>{scenario.title_hi}</span>}
            <span style={{ opacity: 0.5, textTransform: 'capitalize' }}>· {level}</span>
            <span style={{ opacity: 0.5 }}>{idx + 1}/{levelScenarios.length}</span>
          </div>

          {isT && (
            <div style={{ display: 'flex', background: 'rgba(255,251,240,0.95)', borderRadius: 999, padding: 2, boxShadow: '0 4px 14px rgba(0,0,0,0.18)' }}>
              {([['en', 'EN'], ['hi', 'हिं'], ['both', 'Both']] as [Lang, string][]).map(([key, txt]) => (
                <button
                  key={key}
                  onClick={() => write({ 'moduleState.btLanguage': key })}
                  style={{
                    border: 'none', cursor: 'pointer', borderRadius: 999, padding: '3px 8px', fontSize: 13, fontWeight: 800,
                    fontFamily: key === 'hi' ? DEVANAGARI : NUNITO,
                    background: language === key ? 'rgba(74,124,111,0.3)' : 'transparent',
                    color: language === key ? '#2f5c50' : '#9a8570',
                  }}
                >
                  {txt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Therapist level chips */}
        {isT && (
          <div style={{ position: 'absolute', top: 44, left: '50%', transform: 'translateX(-50%)', zIndex: 30, display: 'flex', gap: 4 }}>
            {LEVEL_ORDER.map((l) => (
              <button
                key={l}
                onClick={() => loadScenario(scenariosFor(l)[0].id, l)}
                style={{
                  padding: '2px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 800, textTransform: 'capitalize',
                  fontFamily: NUNITO, border: 'none',
                  background: level === l ? 'rgba(74,124,111,0.85)' : 'rgba(255,251,240,0.85)',
                  color: level === l ? '#fff' : '#8a6a4a',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                }}
              >
                {l}
              </button>
            ))}
          </div>
        )}

        {/* Layer 8 — clue cards. Each role sees ONLY their own card. */}
        <div style={{ position: 'absolute', top: 78, [myClueIsTherapist ? 'left' : 'right']: 16, zIndex: 25 } as React.CSSProperties}>
          <div style={cardBase}>
            {/* folded corner */}
            <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 14px 14px 0', borderColor: `transparent rgba(139,90,43,0.18) transparent transparent`, borderTopRightRadius: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: '#8a5a2a', marginBottom: 6, letterSpacing: 0.3 }}>
              {myClueIsTherapist ? '🧑‍⚕️ Your card (hidden from the child)' : '🧒 Your card (hidden from the therapist)'}
            </div>

            {myClueIsTherapist ? (
              <>
                {showEn && <div style={{ fontSize: 14, fontWeight: 700, color: '#2c1f0e', lineHeight: 1.4 }}>{scenario.therapistClue.en}</div>}
                {language === 'both' && <div style={{ height: 1, background: 'rgba(139,90,43,0.18)', margin: '6px 0' }} />}
                {showHi && <div style={{ fontSize: 14, fontWeight: 600, fontFamily: DEVANAGARI, color: '#6b5540', lineHeight: 1.5 }}>{scenario.therapistClue.hi}</div>}
              </>
            ) : (
              <>
                {showEn && <div style={{ fontSize: 14, fontWeight: 700, color: '#2c1f0e', lineHeight: 1.4 }}>{scenario.childClue.en}</div>}
                {language === 'both' && <div style={{ height: 1, background: 'rgba(139,90,43,0.18)', margin: '6px 0' }} />}
                {showHi && <div style={{ fontSize: 14, fontWeight: 600, fontFamily: DEVANAGARI, color: '#6b5540', lineHeight: 1.5 }}>{scenario.childClue.hi}</div>}
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {scenario.childClue.materialKey.map((k) => (
                    <div key={k.material} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ flexShrink: 0, width: 10, height: 10, borderRadius: 3, background: SWATCH[k.material], border: '1px solid rgba(0,0,0,0.2)' }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.3 }}>
                        {showEn && <span style={{ display: 'block', fontWeight: 700, color: '#2c1f0e' }}>{MATERIAL_LABEL[k.material].en}: {k.label_en}</span>}
                        {showHi && <span style={{ display: 'block', fontFamily: DEVANAGARI, fontWeight: 600, color: '#6b5540' }}>{MATERIAL_LABEL[k.material].hi}: {k.label_hi}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Layer 6 — drop zones */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: isColumn ? '46%' : '52%',
            transform: 'translate(-50%, -50%)',
            zIndex: 20,
            display: 'flex',
            flexDirection: isColumn ? 'column-reverse' : 'row',
            gap: 8,
            animation: shake ? 'btShake 0.32s ease' : 'none',
          }}
        >
          {Array.from({ length: scenario.slotCount }).map((_, i) => {
            const val = filled[String(i)] as MaterialType | undefined
            const isOver = dragOver === i
            return (
              <div
                key={i}
                onDragOver={(e) => { if (canDrag && !completed) { e.preventDefault(); setDragOver(i) } }}
                onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(null)
                  const type = e.dataTransfer.getData('text/plain')
                  if (type) handleDrop(i, type)
                }}
                onDoubleClick={() => clearSlot(i)}
                title={val ? 'Double-click to remove' : undefined}
                style={{
                  width: 44, height: 60, borderRadius: 6,
                  border: `2px dashed ${isOver ? 'rgba(255,235,150,0.9)' : 'rgba(255,255,255,0.45)'}`,
                  background: isOver ? 'rgba(255,235,150,0.15)' : 'rgba(255,255,255,0.08)',
                  boxShadow: isOver ? '0 0 16px rgba(255,220,120,0.4)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
              >
                {val && (
                  <motion.div
                    key={`${i}-${val}`}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                  >
                    <Piece type={val} />
                  </motion.div>
                )}
              </div>
            )
          })}
        </div>

        {/* Success — truck drives across (bridge) / particle burst (all themes) */}
        {burst && (
          <>
            {scenario.theme === 'bridge' && (
              <div style={{ position: 'absolute', top: '44%', zIndex: 24, animation: 'btDrive 3s ease-in-out forwards', pointerEvents: 'none' }}>
                <svg width={58} height={34} viewBox="0 0 58 34">
                  <rect x={2} y={10} width={34} height={14} rx={2} fill="#c8602a" />
                  <rect x={36} y={4} width={16} height={20} rx={2} fill="#e08a4a" />
                  <rect x={39} y={7} width={10} height={8} rx={1} fill="#cfeaf5" />
                  <circle cx={13} cy={27} r={5} fill="#2f2f2f" />
                  <circle cx={44} cy={27} r={5} fill="#2f2f2f" />
                  <circle cx={13} cy={27} r={2} fill="#9aa5ac" />
                  <circle cx={44} cy={27} r={2} fill="#9aa5ac" />
                </svg>
              </div>
            )}
            <div style={{ position: 'absolute', top: '50%', left: '50%', zIndex: 26, width: 0, height: 0, pointerEvents: 'none' }}>
              {Array.from({ length: 16 }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    position: 'absolute', width: 6, height: 6, borderRadius: '50%',
                    background: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
                    '--btx': `${Math.round(Math.cos((i / 16) * Math.PI * 2) * 110)}px`,
                    '--bty': `${Math.round(Math.sin((i / 16) * Math.PI * 2) * 90) - 20}px`,
                    animation: `btParticle ${900 + (i % 5) * 100}ms ease-out ${(i % 6) * 0.03}s forwards`,
                  } as React.CSSProperties}
                />
              ))}
            </div>
          </>
        )}

        {/* Check / Next chip */}
        {isT && (
          <div style={{ position: 'absolute', bottom: 88, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }}>
            {completed ? (
              <button
                onClick={handleNext}
                style={{
                  padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontSize: 16, fontWeight: 800, fontFamily: NUNITO,
                  background: 'rgba(74,124,111,0.95)', border: 'none', color: '#fff', boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                }}
              >
                Next challenge →
              </button>
            ) : (
              <button
                onClick={handleCheck}
                style={{
                  padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontSize: 16, fontWeight: 800, fontFamily: NUNITO,
                  background: 'rgba(255,251,240,0.95)', border: '1px solid rgba(139,90,43,0.25)', color: '#5a3a1a',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.2)',
                }}
              >
                🔍 Check build
              </button>
            )}
          </div>
        )}

        {/* Locked hint */}
        {!canDrag && (
          <div style={{ position: 'absolute', bottom: 88, left: 16, zIndex: 30, fontSize: 13, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
            Therapist is controlling
          </div>
        )}

        {/* Layer 9 — materials shelf */}
        <div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 76, zIndex: 28,
            background: 'linear-gradient(180deg, rgba(255,251,240,0.96) 0%, rgba(245,235,215,0.98) 100%)',
            borderTop: '3px solid rgba(139,90,43,0.25)', boxShadow: '0 -6px 20px rgba(0,0,0,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          }}
        >
          {scenario.materials.map((m) => {
            const left = m.count - (used[m.type] || 0)
            const disabled = !canDrag || completed || left <= 0
            return (
              <div key={m.type} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div
                  draggable={!disabled}
                  onDragStart={(e) => { if (!disabled) e.dataTransfer.setData('text/plain', m.type) }}
                  style={{
                    width: 60, height: 56, borderRadius: 10, background: 'rgba(139,90,43,0.06)',
                    border: '1.5px solid rgba(139,90,43,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: disabled ? 'not-allowed' : 'grab', opacity: disabled ? 0.4 : 1,
                  }}
                >
                  <Piece type={m.type} />
                </div>
                <span
                  style={{
                    position: 'absolute', top: -5, right: -5, minWidth: 19, height: 19, borderRadius: '50%',
                    background: '#c8602a', color: '#fff', fontSize: 13, fontWeight: 900,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fffbf0',
                  }}
                >
                  {left}
                </span>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#5a3a1a', fontFamily: showHi && !showEn ? DEVANAGARI : NUNITO }}>
                  {showEn ? MATERIAL_LABEL[m.type].en : MATERIAL_LABEL[m.type].hi}
                </span>
              </div>
            )
          })}
        </div>

        {/* Facilitator panel — therapist only, after a successful build */}
        <AnimatePresence>
          {isT && completed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              style={{
                position: 'absolute', bottom: 88, right: 16, zIndex: 30, width: 230,
                background: 'rgba(107,92,231,0.92)', border: '1px solid rgba(107,92,231,0.5)',
                borderRadius: 10, padding: '10px 12px', backdropFilter: 'blur(6px)',
              }}
            >
              <button
                onClick={() => setFqOpen((o) => !o)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: '#fff', fontFamily: NUNITO, fontSize: 14, fontWeight: 800 }}
              >
                <span>💬 Ask the child</span>
                <span>{fqOpen ? '▾' : '▸'}</span>
              </button>
              {fqOpen && (
                <ol style={{ margin: '6px 0 0', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {scenario.facilitatorQuestions.map((q, i) => (
                    <li key={i} style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)', lineHeight: 1.35 }}>
                      <span style={{ display: 'block' }}>{q.en}</span>
                      <span style={{ display: 'block', fontFamily: DEVANAGARI, color: 'rgba(255,255,255,0.7)' }}>{q.hi}</span>
                    </li>
                  ))}
                </ol>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
