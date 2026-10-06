'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { doc, onSnapshot, updateDoc, arrayUnion, increment } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { logModuleEvent } from '@/lib/sessionEvents'
import { AnimatePresence, motion } from 'motion/react'

interface TreasureQuestProps {
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}

type Level = 'easy' | 'moderate' | 'advanced'
type Lang = 'en' | 'hi' | 'both'
type Role = 'therapist' | 'client'
type SceneTheme = 'study' | 'attic' | 'cellar' | 'library' | 'garden-shed' | 'workshop'
type Shape = 'notebook' | 'locker' | 'key' | 'chest' | 'drawer' | 'map' | 'lantern' | 'jar' | 'painting' | 'box'

type Hotspot = { id: string; x: number; y: number; shape: Shape; isCorrect: boolean }

type Stage = {
  stageIndex: number
  sceneTheme: SceneTheme
  searcherRole: Role
  hotspots: Hotspot[]
  searcherPrompt: { en: string; hi: string }
  decoderClue: { en: string; hi: string }
  onFoundReveal: { en: string; hi: string }
}

type Scenario = {
  id: string
  level: Level
  title_en: string
  title_hi: string
  stages: Stage[]
  treasureReveal: { en: string; hi: string; emoji: string }
  facilitatorQuestions: Array<{ en: string; hi: string }>
}

// Reflection questions are about the shared-information process itself, so they
// apply unchanged to every quest rather than being re-authored 30 times.
const FQ: Array<{ en: string; hi: string }> = [
  { en: 'What was hard about only having half the clue?', hi: 'सिर्फ आधा सुराग होने में क्या मुश्किल था?' },
  { en: 'How did talking to each other help you find the treasure?', hi: 'एक-दूसरे से बात करने से खज़ाना ढूँढने में कैसे मदद मिली?' },
  { en: 'Which stage did you enjoy searching in the most?', hi: 'किस चरण में खोजना तुम्हें सबसे ज़्यादा अच्छा लगा?' },
  { en: 'What would happen if nobody shared what they knew?', hi: 'अगर किसी ने अपनी जानकारी नहीं बताई होती तो क्या होता?' },
]

const SCENARIOS: Scenario[] = [
  {
    id: 'easy_1', level: 'easy',
    title_en: "The Grandmother's Study", title_hi: 'दादी का अध्ययन कक्ष',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 20, y: 60, shape: 'notebook', isCorrect: false },
          { id: 'h2', x: 45, y: 35, shape: 'painting', isCorrect: true },
          { id: 'h3', x: 70, y: 55, shape: 'lantern', isCorrect: false },
          { id: 'h4', x: 85, y: 70, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'Look around the study. Something in this room is hiding a secret.', hi: 'अध्ययन कक्ष में देखो। इस कमरे में कुछ चीज़ में एक राज़ छिपा है।' },
        decoderClue: { en: 'Grandmother always said her favourite memory was hanging on the wall.', hi: 'दादी हमेशा कहती थीं कि उनकी पसंदीदा याद दीवार पर टंगी है।' },
        onFoundReveal: { en: 'Behind the painting is a small folded map!', hi: 'पेंटिंग के पीछे एक छोटा मुड़ा हुआ नक्शा है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 40, shape: 'jar', isCorrect: false },
          { id: 'h2', x: 55, y: 65, shape: 'box', isCorrect: true },
          { id: 'h3', x: 75, y: 30, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The map led you to the attic. Something here holds the next clue.', hi: 'नक्शा तुम्हें अटारी तक ले आया। यहाँ कुछ में अगला सुराग है।' },
        decoderClue: { en: 'The map has a small drawing of an old wooden box tied with string.', hi: 'नक्शे में डोरी से बंधे एक पुराने लकड़ी के बक्से की तस्वीर है।' },
        onFoundReveal: { en: 'Inside the box is a rusty old key!', hi: 'बक्से के अंदर एक पुरानी जंग लगी चाबी है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 25, y: 50, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 50, y: 45, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 75, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'You have the key. Find what it opens.', hi: 'तुम्हारे पास चाबी है। ढूँढो कि यह क्या खोलती है।' },
        decoderClue: { en: 'The key has a small carved star on it — look for something with a matching star.', hi: 'चाबी पर एक छोटा तारा बना है — कुछ ऐसा ढूँढो जिस पर वैसा ही तारा हो।' },
        onFoundReveal: { en: 'The star-marked chest creaks open...', hi: 'तारे के निशान वाला बक्सा चरचराते हुए खुल जाता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is Grandmother’s collection of sea shells from every place she ever visited!',
      hi: 'अंदर दादी के इकट्ठा किए हुए सीप हैं, जो वे हर उस जगह से लाई थीं जहाँ वे गई थीं!',
      emoji: '🐚',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_2', level: 'easy',
    title_en: "The Lighthouse Keeper's Secret", title_hi: 'प्रकाशस्तंभ रखवाले का राज़',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 55, shape: 'jar', isCorrect: false },
          { id: 'h2', x: 48, y: 40, shape: 'lantern', isCorrect: true },
          { id: 'h3', x: 72, y: 62, shape: 'box', isCorrect: false },
          { id: 'h4', x: 86, y: 38, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The lighthouse lamp room is quiet. Something here still remembers the light.', hi: 'प्रकाशस्तंभ का दीप कक्ष शांत है। यहाँ कुछ है जिसे आज भी रोशनी याद है।' },
        decoderClue: { en: 'The keeper wrote that he never let one thing go out, even on the calmest night.', hi: 'रखवाले ने लिखा था कि सबसे शांत रात में भी उन्होंने एक चीज़ कभी बुझने नहीं दी।' },
        onFoundReveal: { en: 'Tucked under the old lantern is a folded tide chart!', hi: 'पुरानी लालटेन के नीचे एक मुड़ा हुआ ज्वार-भाटा चार्ट रखा है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 62, shape: 'jar', isCorrect: false },
          { id: 'h2', x: 52, y: 38, shape: 'map', isCorrect: true },
          { id: 'h3', x: 78, y: 58, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'The tide chart points to the storage loft above the stairs.', hi: 'ज्वार-भाटा चार्ट सीढ़ियों के ऊपर वाले भंडार कक्ष की ओर इशारा करता है।' },
        decoderClue: { en: "The chart's torn edge shows the missing piece was rolled up, not folded.", hi: 'चार्ट का फटा किनारा बताता है कि गुम टुकड़ा मोड़ा नहीं, लपेटा गया था।' },
        onFoundReveal: { en: 'The rolled map has a small brass key tied to its string!', hi: 'लपेटे हुए नक्शे की डोरी से एक छोटी पीतल की चाबी बंधी है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 58, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 52, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 78, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The key is small and brass. Find the thing it was made for.', hi: 'चाबी छोटी और पीतल की है। वह चीज़ ढूँढो जिसके लिए यह बनी थी।' },
        decoderClue: { en: 'The keeper kept his dearest things where sea air could not reach — behind a lid, not a handle.', hi: 'रखवाला अपनी सबसे प्यारी चीज़ें वहाँ रखता था जहाँ समुद्री हवा न पहुँचे — ढक्कन के पीछे, हैंडल के पीछे नहीं।' },
        onFoundReveal: { en: 'The little brass lock clicks open...', hi: 'छोटा पीतल का ताला खटाक से खुल जाता है...' },
      },
    ],
    treasureReveal: {
      en: "Inside is the keeper's logbook, naming every single ship he guided safely home.",
      hi: 'अंदर रखवाले की लॉगबुक है, जिसमें हर उस जहाज़ का नाम है जिसे उन्होंने सुरक्षित घर पहुँचाया।',
      emoji: '📖',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_3', level: 'easy',
    title_en: "The Baker's Hidden Recipe", title_hi: 'हलवाई की छिपी हुई रेसिपी',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 24, y: 42, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 50, y: 62, shape: 'box', isCorrect: false },
          { id: 'h3', x: 74, y: 40, shape: 'notebook', isCorrect: false },
          { id: 'h4', x: 88, y: 66, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The old bakery still smells of cinnamon. Something on the shelf is not what it seems.', hi: 'पुरानी बेकरी में आज भी दालचीनी की खुशबू है। शेल्फ़ पर रखी एक चीज़ वैसी नहीं है जैसी दिखती है।' },
        decoderClue: { en: 'The baker hid notes where flour would never spoil them — somewhere you can see through.', hi: 'हलवाई अपने नोट वहाँ छिपाते थे जहाँ आटा उन्हें खराब न करे — किसी ऐसी जगह जिसके आर-पार दिखता हो।' },
        onFoundReveal: { en: 'Inside the glass jar is a rolled-up paper with half a recipe!', hi: 'काँच के मर्तबान में आधी रेसिपी वाला एक लिपटा हुआ कागज़ है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 56, y: 36, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 80, y: 62, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'Half a recipe is no recipe. The other half must be written somewhere.', hi: 'आधी रेसिपी कोई रेसिपी नहीं। बाकी आधी कहीं तो लिखी होगी।' },
        decoderClue: { en: 'The paper ends mid-sentence, and the handwriting matches a book the baker wrote in every night.', hi: 'कागज़ बीच वाक्य में खत्म होता है, और लिखावट उस किताब से मिलती है जिसमें हलवाई हर रात लिखते थे।' },
        onFoundReveal: { en: 'The notebook falls open to a page marked with a ribbon!', hi: 'नोटबुक रिबन लगे एक पन्ने पर खुल जाती है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 46, shape: 'chest', isCorrect: false },
          { id: 'h2', x: 52, y: 60, shape: 'drawer', isCorrect: true },
          { id: 'h3', x: 78, y: 42, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The recipe names one last ingredient, kept cool below the shop.', hi: 'रेसिपी में एक आख़िरी सामग्री का नाम है, जो दुकान के नीचे ठंडी जगह रखी थी।' },
        decoderClue: { en: 'The ribboned page says: "the tin with the handle, never the trunk."', hi: 'रिबन वाले पन्ने पर लिखा है: "हैंडल वाला डिब्बा, संदूक कभी नहीं।"' },
        onFoundReveal: { en: 'The little drawer slides open with a soft rattle...', hi: 'छोटा दराज़ हल्की खड़खड़ाहट के साथ खुल जाता है...' },
      },
    ],
    treasureReveal: {
      en: "Inside is the baker's family recipe card, written by her mother and passed down for sixty years.",
      hi: 'अंदर हलवाई के परिवार की रेसिपी है, जो उनकी माँ ने लिखी थी और साठ साल से चली आ रही है।',
      emoji: '🥐',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_4', level: 'easy',
    title_en: "The Gardener's Buried Seeds", title_hi: 'माली के दबे हुए बीज',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'garden-shed', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 58, shape: 'box', isCorrect: false },
          { id: 'h2', x: 46, y: 44, shape: 'notebook', isCorrect: true },
          { id: 'h3', x: 72, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h4', x: 88, y: 40, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The garden shed is warm and dusty. The gardener left instructions somewhere.', hi: 'बगीचे की झोपड़ी गर्म और धूल भरी है। माली ने कहीं हिदायतें छोड़ी हैं।' },
        decoderClue: { en: 'The gardener wrote down every planting day — he never trusted his memory.', hi: 'माली हर बुवाई का दिन लिख लेते थे — उन्हें अपनी याददाश्त पर कभी भरोसा नहीं था।' },
        onFoundReveal: { en: 'The planting journal lists a bed that was never harvested!', hi: 'बुवाई की डायरी में एक क्यारी का ज़िक्र है जिसकी कभी कटाई नहीं हुई!' },
      },
      {
        stageIndex: 1, sceneTheme: 'workshop', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 40, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 54, y: 62, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 44, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The journal mentions seeds kept safe for a season that never came.', hi: 'डायरी में उन बीजों का ज़िक्र है जो एक ऐसे मौसम के लिए सँभाले गए जो कभी नहीं आया।' },
        decoderClue: { en: 'Seeds must stay dry, so he kept them where he could count them without opening anything.', hi: 'बीज सूखे रहने चाहिए, इसलिए वे उन्हें वहाँ रखते थे जहाँ बिना खोले गिने जा सकें।' },
        onFoundReveal: { en: 'The seed jar holds a small hand-drawn map of the garden!', hi: 'बीज के मर्तबान में बगीचे का एक छोटा हाथ से बना नक्शा है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 60, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 52, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 78, y: 58, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'The map marks a cool dark place below the greenhouse.', hi: 'नक्शे में ग्रीनहाउस के नीचे एक ठंडी अँधेरी जगह का निशान है।' },
        decoderClue: { en: 'The map shows a lid with two straps across it, not a handle.', hi: 'नक्शे में ऐसा ढक्कन बना है जिस पर दो पट्टियाँ हैं, हैंडल नहीं।' },
        onFoundReveal: { en: 'The strapped chest opens with a puff of dry soil...', hi: 'पट्टियों वाला संदूक सूखी मिट्टी की भाप के साथ खुल जाता है...' },
      },
    ],
    treasureReveal: {
      en: "Inside are the seeds of the gardener's favourite flower, still alive and ready to plant again.",
      hi: 'अंदर माली के पसंदीदा फूल के बीज हैं, जो आज भी ज़िंदा हैं और फिर से बोए जा सकते हैं।',
      emoji: '🌻',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_5', level: 'easy',
    title_en: "The Sailor's Map", title_hi: 'नाविक का नक्शा',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'attic', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 24, y: 46, shape: 'box', isCorrect: false },
          { id: 'h2', x: 50, y: 58, shape: 'map', isCorrect: true },
          { id: 'h3', x: 76, y: 40, shape: 'lantern', isCorrect: false },
          { id: 'h4', x: 88, y: 64, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The sailor stored everything from his voyages up here. Start with what guided him.', hi: 'नाविक ने अपनी यात्राओं का सारा सामान यहीं ऊपर रखा था। उसी से शुरू करो जो उन्हें रास्ता दिखाता था।' },
        decoderClue: { en: 'A sailor never folded the thing he trusted most — he rolled it, to keep the lines clean.', hi: 'नाविक जिस चीज़ पर सबसे ज़्यादा भरोसा करते थे उसे कभी मोड़ते नहीं थे — लपेटते थे, ताकि लकीरें साफ़ रहें।' },
        onFoundReveal: { en: 'The rolled map shows a harbour with one island circled!', hi: 'लपेटे हुए नक्शे में एक बंदरगाह है जिसमें एक द्वीप पर गोला बना है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 38, shape: 'painting', isCorrect: true },
          { id: 'h2', x: 56, y: 60, shape: 'notebook', isCorrect: false },
          { id: 'h3', x: 82, y: 44, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The circled island must mean something. Look for it somewhere else in the house.', hi: 'गोले वाले द्वीप का कुछ तो मतलब होगा। उसे घर में कहीं और ढूँढो।' },
        decoderClue: { en: 'The sailor loved that island so much he had someone paint it for him.', hi: 'नाविक को वह द्वीप इतना पसंद था कि उन्होंने किसी से उसकी पेंटिंग बनवाई थी।' },
        onFoundReveal: { en: 'Taped to the back of the painting is a tiny iron key!', hi: 'पेंटिंग के पीछे एक छोटी लोहे की चाबी चिपकी है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 52, y: 60, shape: 'drawer', isCorrect: false },
          { id: 'h3', x: 78, y: 46, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The iron key is heavy and old. Find the heaviest, oldest thing down here.', hi: 'लोहे की चाबी भारी और पुरानी है। यहाँ नीचे सबसे भारी और सबसे पुरानी चीज़ ढूँढो।' },
        decoderClue: { en: 'The sailor kept his sea trunk from his very first voyage — brass corners, rounded lid.', hi: 'नाविक ने अपनी पहली यात्रा वाला समुद्री संदूक सँभाल रखा था — पीतल के कोने, गोल ढक्कन।' },
        onFoundReveal: { en: 'The old sea trunk groans open...', hi: 'पुराना समुद्री संदूक कराहते हुए खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside are letters the sailor wrote home from every port — never sent, all kept.',
      hi: 'अंदर वे चिट्ठियाँ हैं जो नाविक ने हर बंदरगाह से घर लिखीं — कभी भेजी नहीं, सब सँभाल कर रखीं।',
      emoji: '💌',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_6', level: 'easy',
    title_en: "The Painter's Lost Colours", title_hi: 'चित्रकार के खोए हुए रंग',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 40, shape: 'painting', isCorrect: true },
          { id: 'h2', x: 48, y: 62, shape: 'box', isCorrect: false },
          { id: 'h3', x: 74, y: 44, shape: 'jar', isCorrect: false },
          { id: 'h4', x: 88, y: 66, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The painter left one canvas unfinished. It may be trying to tell you something.', hi: 'चित्रकार ने एक कैनवास अधूरा छोड़ा था। शायद वह तुम्हें कुछ बताना चाहता है।' },
        decoderClue: { en: 'She always said her last painting was a question, not an answer.', hi: 'वे हमेशा कहती थीं कि उनकी आख़िरी पेंटिंग एक सवाल है, जवाब नहीं।' },
        onFoundReveal: { en: 'The unfinished canvas has a colour name written in the corner: "hers."', hi: 'अधूरे कैनवास के कोने में एक रंग का नाम लिखा है: "उनका"।' },
      },
      {
        stageIndex: 1, sceneTheme: 'workshop', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 58, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 54, y: 40, shape: 'lantern', isCorrect: false },
          { id: 'h3', x: 80, y: 62, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'A colour has to live somewhere. Find where she mixed them.', hi: 'रंग कहीं तो रहता है। ढूँढो कि वे रंग कहाँ मिलाती थीं।' },
        decoderClue: { en: 'She ground her own pigments and stored each one where she could see the shade through the glass.', hi: 'वे अपने रंग खुद पीसती थीं और हर रंग वहाँ रखती थीं जहाँ काँच के आर-पार शेड दिख जाए।' },
        onFoundReveal: { en: 'One jar is labelled in her handwriting — and it is empty!', hi: 'एक मर्तबान पर उनकी लिखावट में नाम है — और वह खाली है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'attic', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 42, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 52, y: 58, shape: 'box', isCorrect: true },
          { id: 'h3', x: 78, y: 44, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'If the jar is empty, she moved the colour somewhere safer.', hi: 'अगर मर्तबान खाली है, तो उन्होंने रंग किसी और सुरक्षित जगह रखा होगा।' },
        decoderClue: { en: 'The empty jar’s label says "moved upstairs — packed in wood, away from the light."', hi: 'खाली मर्तबान के लेबल पर लिखा है "ऊपर ले गई — लकड़ी में पैक, रोशनी से दूर"।' },
        onFoundReveal: { en: 'The wooden crate lifts open, and colour spills out...', hi: 'लकड़ी का बक्सा खुलता है और रंग बिखर जाते हैं...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the colour she mixed for her daughter’s eyes, saved for a portrait she never got to finish.',
      hi: 'अंदर वह रंग है जो उन्होंने अपनी बेटी की आँखों के लिए बनाया था, उस तस्वीर के लिए जो कभी पूरी न हो सकी।',
      emoji: '🎨',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_7', level: 'easy',
    title_en: "The Music Teacher's Hidden Song", title_hi: 'संगीत शिक्षक का छिपा हुआ गीत',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'library', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 56, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 38, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 42, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The music room is full of paper. One page is not like the others.', hi: 'संगीत कक्ष कागज़ों से भरा है। एक पन्ना बाकियों जैसा नहीं है।' },
        decoderClue: { en: 'He taught from printed books, but he only ever wrote his own songs by hand.', hi: 'वे छपी किताबों से पढ़ाते थे, पर अपने गीत हमेशा हाथ से ही लिखते थे।' },
        onFoundReveal: { en: 'The handwritten notebook has a song with no title — just a date!', hi: 'हाथ से लिखी नोटबुक में एक गीत है जिसका कोई नाम नहीं — सिर्फ़ एक तारीख़!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 60, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 56, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 82, y: 58, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'A date must mean something. Look for what he kept from that day.', hi: 'तारीख़ का कुछ मतलब होगा। ढूँढो कि उस दिन की उन्होंने क्या चीज़ सँभाली।' },
        decoderClue: { en: 'He kept small things from important days close to where he sat — behind a little handle.', hi: 'ख़ास दिनों की छोटी चीज़ें वे अपने बैठने की जगह के पास रखते थे — एक छोटे हैंडल के पीछे।' },
        onFoundReveal: { en: 'In the drawer is a concert ticket with a seat number circled!', hi: 'दराज़ में एक कॉन्सर्ट टिकट है जिस पर सीट नंबर पर गोला बना है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'attic', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 52, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 78, y: 42, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'The ticket is from the night he wrote the song. Find where that night is kept.', hi: 'टिकट उसी रात का है जब उन्होंने गीत लिखा था। ढूँढो कि वह रात कहाँ सँभाली गई है।' },
        decoderClue: { en: 'He packed that whole evening into one place with a rounded lid and brass corners.', hi: 'उन्होंने वह पूरी शाम एक ही जगह रख दी थी — गोल ढक्कन और पीतल के कोनों वाली।' },
        onFoundReveal: { en: 'The trunk opens and old paper rustles softly...', hi: 'संदूक खुलता है और पुराने कागज़ धीरे से सरसराते हैं...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the song he wrote the night his first student played without being afraid.',
      hi: 'अंदर वह गीत है जो उन्होंने उस रात लिखा था जब उनके पहले छात्र ने बिना डरे बजाया था।',
      emoji: '🎵',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_8', level: 'easy',
    title_en: "The Librarian's Secret Shelf", title_hi: 'पुस्तकालय अध्यक्ष की गुप्त शेल्फ़',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'library', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 42, shape: 'lantern', isCorrect: false },
          { id: 'h2', x: 48, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h3', x: 74, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h4', x: 88, y: 62, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'Thousands of books, and the librarian loved one shelf more than the rest.', hi: 'हज़ारों किताबें, और पुस्तकालय अध्यक्ष को एक शेल्फ़ बाकी सबसे ज़्यादा प्यारी थी।' },
        decoderClue: { en: 'She kept a record of every book anyone ever cried over — in her own hand.', hi: 'वे हर उस किताब का हिसाब रखती थीं जिस पर कोई रोया हो — अपने ही हाथ से।' },
        onFoundReveal: { en: 'Her record book lists one title borrowed a hundred times!', hi: 'उनकी रजिस्टर में एक किताब है जो सौ बार पढ़ने को ले जाई गई!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h2', x: 56, y: 62, shape: 'drawer', isCorrect: true },
          { id: 'h3', x: 82, y: 42, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'A book borrowed a hundred times must have left something behind.', hi: 'सौ बार ले जाई गई किताब ने कुछ तो पीछे छोड़ा होगा।' },
        decoderClue: { en: 'She saved every note readers left tucked inside returned books, in a place with a small handle.', hi: 'लौटाई गई किताबों में पाठक जो पर्चियाँ छोड़ जाते, वे सब उन्होंने एक छोटे हैंडल वाली जगह में रखीं।' },
        onFoundReveal: { en: 'The drawer is full of little folded notes — and one library card!', hi: 'दराज़ छोटी मुड़ी हुई पर्चियों से भरा है — और एक लाइब्रेरी कार्ड!' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 58, shape: 'box', isCorrect: true },
          { id: 'h2', x: 52, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 78, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The library card has a number. The archive below holds what matches it.', hi: 'लाइब्रेरी कार्ड पर एक नंबर है। नीचे के संग्रह में वही चीज़ है जो उससे मिलती है।' },
        decoderClue: { en: 'Down here nothing is locked — the archive is stored in plain wooden crates, numbered on the side.', hi: 'यहाँ नीचे कुछ भी बंद नहीं है — संग्रह सादे लकड़ी के बक्सों में है, जिन पर किनारे नंबर लिखे हैं।' },
        onFoundReveal: { en: 'The numbered crate lifts open easily...', hi: 'नंबर वाला बक्सा आसानी से खुल जाता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the first book she ever recommended to a child who said they hated reading.',
      hi: 'अंदर वह पहली किताब है जो उन्होंने एक ऐसे बच्चे को दी थी जिसने कहा था कि उसे पढ़ना पसंद नहीं।',
      emoji: '📚',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_9', level: 'easy',
    title_en: "The Toy Maker's Puzzle", title_hi: 'खिलौने बनाने वाले की पहेली',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 60, shape: 'box', isCorrect: true },
          { id: 'h2', x: 48, y: 40, shape: 'lantern', isCorrect: false },
          { id: 'h3', x: 74, y: 58, shape: 'jar', isCorrect: false },
          { id: 'h4', x: 88, y: 40, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The workshop is full of half-made toys. One box was finished but never opened.', hi: 'कार्यशाला अधबने खिलौनों से भरी है। एक डिब्बा पूरा बना पर कभी खोला नहीं गया।' },
        decoderClue: { en: 'He built puzzle boxes for children — the finished ones had no scratches on the lid.', hi: 'वे बच्चों के लिए पहेली वाले डिब्बे बनाते थे — पूरे बने डिब्बों के ढक्कन पर कोई खरोंच नहीं होती थी।' },
        onFoundReveal: { en: 'The puzzle box rattles — something small is inside, and it needs a key!', hi: 'पहेली वाला डिब्बा खड़खड़ाता है — अंदर कुछ छोटा है, और उसे चाबी चाहिए!' },
      },
      {
        stageIndex: 1, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 44, shape: 'key', isCorrect: true },
          { id: 'h2', x: 56, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 82, y: 42, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'Every puzzle box he made had its key hidden in the same kind of place.', hi: 'उनके बनाए हर पहेली वाले डिब्बे की चाबी हमेशा एक ही तरह की जगह छिपी होती थी।' },
        decoderClue: { en: 'He never kept a key with its box — he hung it high, where a child could see it but not reach it.', hi: 'वे चाबी कभी डिब्बे के साथ नहीं रखते थे — उसे ऊँचाई पर टाँगते थे, जहाँ बच्चा देख तो सके पर पहुँच न सके।' },
        onFoundReveal: { en: 'A tiny brass key hangs from a nail on the beam!', hi: 'शहतीर की कील पर एक छोटी पीतल की चाबी टँगी है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 46, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 52, y: 58, shape: 'box', isCorrect: true },
          { id: 'h3', x: 78, y: 44, shape: 'chest', isCorrect: false },
        ],
        searcherPrompt: { en: 'You have the key. Go back and open what was waiting.', hi: 'तुम्हारे पास चाबी है। वापस जाओ और जो इंतज़ार कर रहा था उसे खोलो।' },
        decoderClue: { en: 'It is the small box with no scratches on the lid — not the trunk, not the drawer.', hi: 'वही छोटा डिब्बा जिसके ढक्कन पर खरोंच नहीं — न संदूक, न दराज़।' },
        onFoundReveal: { en: 'The puzzle box springs open with a soft click...', hi: 'पहेली वाला डिब्बा हल्की खटक के साथ खुल जाता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the very first toy he ever made — a small wooden bird, carved when he was eight.',
      hi: 'अंदर उनका बनाया सबसे पहला खिलौना है — लकड़ी की एक छोटी चिड़िया, जो उन्होंने आठ साल की उम्र में तराशी थी।',
      emoji: '🐦',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'easy_10', level: 'easy',
    title_en: "The Farmer's Hidden Harvest", title_hi: 'किसान की छिपी हुई फ़सल',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'garden-shed', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 44, shape: 'lantern', isCorrect: false },
          { id: 'h2', x: 48, y: 60, shape: 'notebook', isCorrect: true },
          { id: 'h3', x: 74, y: 42, shape: 'jar', isCorrect: false },
          { id: 'h4', x: 88, y: 62, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'The farmer kept one harvest back every single year. Find out why.', hi: 'किसान हर साल एक हिस्सा फ़सल का बचा लेते थे। पता करो क्यों।' },
        decoderClue: { en: 'He counted every basket in writing — the count never matched what he sold.', hi: 'वे हर टोकरी का हिसाब लिखते थे — गिनती कभी बेचे गए माल से नहीं मिलती थी।' },
        onFoundReveal: { en: 'The ledger shows one basket set aside each autumn, never sold!', hi: 'बही में हर पतझड़ एक टोकरी अलग रखी दिखती है, जो कभी बेची नहीं गई!' },
      },
      {
        stageIndex: 1, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 58, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 56, y: 42, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 82, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'Something set aside every autumn has to be stored somewhere cool.', hi: 'हर पतझड़ अलग रखी गई चीज़ कहीं ठंडी जगह ही रखी जाएगी।' },
        decoderClue: { en: 'He preserved what he saved, so he could still see it years later — through glass.', hi: 'जो बचाते थे उसे सुरक्षित रखते थे, ताकि सालों बाद भी देख सकें — काँच के आर-पार।' },
        onFoundReveal: { en: 'Inside the preserve jar is a folded note with a field number!', hi: 'अचार के मर्तबान में एक मुड़ी हुई पर्ची है जिस पर खेत का नंबर है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'garden-shed', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 42, shape: 'box', isCorrect: true },
          { id: 'h2', x: 52, y: 60, shape: 'drawer', isCorrect: false },
          { id: 'h3', x: 78, y: 44, shape: 'chest', isCorrect: false },
        ],
        searcherPrompt: { en: 'The note names a field. Whatever came from it is back in the shed.', hi: 'पर्ची में एक खेत का नाम है। उससे जो आया वह वापस झोपड़ी में है।' },
        decoderClue: { en: 'A harvest basket is packed in a plain crate — no lock, no lid straps, just wood.', hi: 'फ़सल की टोकरी एक सादे बक्से में रखी है — न ताला, न पट्टियाँ, बस लकड़ी।' },
        onFoundReveal: { en: 'The crate opens and smells of dry wheat...', hi: 'बक्सा खुलता है और सूखे गेहूँ की महक आती है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the harvest he kept back every year to give away to families who had none.',
      hi: 'अंदर वह फ़सल है जो वे हर साल उन परिवारों को देने के लिए बचाते थे जिनके पास कुछ नहीं था।',
      emoji: '🌾',
    },
    facilitatorQuestions: FQ,
  },

  {
    id: 'mod_11', level: 'moderate',
    title_en: "The Clockmaker's Last Hour", title_hi: 'घड़ीसाज़ का आख़िरी घंटा',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 46, y: 40, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 72, y: 60, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 40, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: "The clockmaker's bench is exactly as he left it. Start with what he wrote.", hi: 'घड़ीसाज़ की मेज़ बिल्कुल वैसी ही है जैसी वे छोड़ गए थे। जो उन्होंने लिखा, वहीं से शुरू करो।' },
        decoderClue: { en: 'He recorded two things every day: the time he started and the time he stopped. Only one day has both left blank.', hi: 'वे हर दिन दो चीज़ें लिखते थे: शुरू करने का समय और रोकने का समय। सिर्फ़ एक दिन दोनों खाली हैं।' },
        onFoundReveal: { en: 'The bench journal falls open at the day he never finished!', hi: 'मेज़ की डायरी उसी दिन पर खुल जाती है जिसे वे कभी पूरा न कर सके!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h2', x: 54, y: 62, shape: 'drawer', isCorrect: true },
          { id: 'h3', x: 82, y: 44, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'That unfinished day must have left something behind in his study.', hi: 'उस अधूरे दिन ने उनके अध्ययन कक्ष में कुछ तो छोड़ा होगा।' },
        decoderClue: { en: 'The journal says the piece was small enough for a pocket, and he kept small things behind a handle — never on a shelf.', hi: 'डायरी कहती है कि वह चीज़ जेब में समा जाए इतनी छोटी थी, और छोटी चीज़ें वे हैंडल के पीछे रखते थे — शेल्फ़ पर कभी नहीं।' },
        onFoundReveal: { en: 'In the drawer is a half-finished watch face and a tiny key!', hi: 'दराज़ में आधी बनी घड़ी का चेहरा और एक नन्ही चाबी है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'attic', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 44, shape: 'jar', isCorrect: false },
          { id: 'h2', x: 52, y: 60, shape: 'box', isCorrect: true },
          { id: 'h3', x: 80, y: 42, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The tiny key belongs to something stored away upstairs.', hi: 'नन्ही चाबी ऊपर रखी किसी चीज़ की है।' },
        decoderClue: { en: 'The watch face has a date engraved, and that same date is marked on only one thing up here — something wooden, not glass.', hi: 'घड़ी के चेहरे पर एक तारीख़ खुदी है, और वही तारीख़ यहाँ सिर्फ़ एक चीज़ पर है — जो लकड़ी की है, काँच की नहीं।' },
        onFoundReveal: { en: 'The dated wooden box opens — inside is a folded letter!', hi: 'तारीख़ वाला लकड़ी का बक्सा खुलता है — अंदर एक मुड़ी हुई चिट्ठी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 26, y: 58, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 52, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 78, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The letter names one last place, below the shop.', hi: 'चिट्ठी में एक आख़िरी जगह का नाम है, दुकान के नीचे।' },
        decoderClue: { en: 'The letter asks for two things at once: something marked with a star, and something you lift by the lid. Only one thing down there is both.', hi: 'चिट्ठी में दो बातें एक साथ हैं: जिस पर तारा हो, और जिसे ढक्कन से उठाया जाए। नीचे सिर्फ़ एक चीज़ में दोनों हैं।' },
        onFoundReveal: { en: 'The star-marked trunk opens slowly...', hi: 'तारे के निशान वाला संदूक धीरे से खुलता है...' },
      },
    ],
    treasureReveal: {
      en: "Inside is the pocket watch he was making for his daughter's first day of school — finished after all, and never given.",
      hi: 'अंदर वह जेब घड़ी है जो वे अपनी बेटी के स्कूल के पहले दिन के लिए बना रहे थे — आख़िरकार पूरी, पर कभी दी नहीं गई।',
      emoji: '🕰️',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_12', level: 'moderate',
    title_en: "The Weaver's Pattern", title_hi: 'बुनकर का नमूना',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 24, y: 42, shape: 'box', isCorrect: true },
          { id: 'h2', x: 50, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 76, y: 42, shape: 'notebook', isCorrect: false },
          { id: 'h4', x: 88, y: 64, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The loom is still threaded. The weaver kept her patterns somewhere close by.', hi: 'करघे में आज भी धागा लगा है। बुनकर अपने नमूने पास ही कहीं रखती थीं।' },
        decoderClue: { en: 'She sorted her patterns two ways: by colour, and by who they were for. The family ones were never on the open shelf.', hi: 'वे अपने नमूने दो तरह से रखती थीं: रंग से, और किसके लिए हैं उससे। परिवार वाले कभी खुली शेल्फ़ पर नहीं होते थे।' },
        onFoundReveal: { en: 'The closed box holds pattern cards — one is unfinished!', hi: 'बंद बक्से में नमूनों के कार्ड हैं — एक अधूरा है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 56, y: 38, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 82, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'An unfinished pattern needs its instructions. She wrote everything down.', hi: 'अधूरे नमूने को उसकी हिदायतें चाहिए। वे सब कुछ लिख लेती थीं।' },
        decoderClue: { en: 'The pattern card has a number and a colour on the back. Both together point to a page in the book she kept by her chair.', hi: 'नमूने के कार्ड के पीछे एक नंबर और एक रंग है। दोनों मिलकर उस किताब के एक पन्ने की ओर इशारा करते हैं जो वे अपनी कुर्सी के पास रखती थीं।' },
        onFoundReveal: { en: 'The pattern book opens to a page listing one missing colour!', hi: 'नमूनों की किताब उस पन्ने पर खुलती है जिसमें एक गुम रंग लिखा है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'garden-shed', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 60, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 52, y: 42, shape: 'box', isCorrect: false },
          { id: 'h3', x: 78, y: 58, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The missing colour was made, not bought. Find where she made it.', hi: 'गुम रंग खरीदा नहीं, बनाया गया था। ढूँढो कि वे उसे कहाँ बनाती थीं।' },
        decoderClue: { en: 'She dyed with plants from this shed, and she stored dye two ways — dry in wood, wet in glass. The book says this one was still wet.', hi: 'वे इसी झोपड़ी के पौधों से रंग बनाती थीं, और रंग दो तरह रखती थीं — सूखा लकड़ी में, गीला काँच में। किताब कहती है यह अब भी गीला था।' },
        onFoundReveal: { en: 'The dye jar still holds colour — and a key rests at the bottom!', hi: 'रंग के मर्तबान में आज भी रंग है — और तल में एक चाबी पड़ी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 42, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The key from the dye jar opens something she finished long ago.', hi: 'रंग के मर्तबान वाली चाबी उस चीज़ को खोलती है जो उन्होंने बहुत पहले पूरी की थी।' },
        decoderClue: { en: 'She kept finished family work away from light and away from damp — that means a lid and brass corners, not an open crate.', hi: 'तैयार पारिवारिक काम वे रोशनी और नमी दोनों से बचाकर रखती थीं — यानी ढक्कन और पीतल के कोने, खुला बक्सा नहीं।' },
        onFoundReveal: { en: 'The brass-cornered trunk opens with a soft sigh...', hi: 'पीतल के कोनों वाला संदूक हल्की आह के साथ खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the shawl she wove for her mother, in the colour she mixed herself and never used again.',
      hi: 'अंदर वह शॉल है जो उन्होंने अपनी माँ के लिए बुनी थी, उसी रंग में जो उन्होंने खुद बनाया और फिर कभी इस्तेमाल नहीं किया।',
      emoji: '🧣',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_13', level: 'moderate',
    title_en: "The Beekeeper's Note", title_hi: 'मधुमक्खी पालक की पर्ची',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'garden-shed', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 44, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 62, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 74, y: 42, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 62, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The bee shed is warm and quiet. The keeper wrote to the hives like friends.', hi: 'मधुमक्खी की झोपड़ी गर्म और शांत है। पालक छत्तों को दोस्तों की तरह लिखते थे।' },
        decoderClue: { en: 'He wrote two records: one for honey taken, one for hives lost. Only one hive appears in both.', hi: 'वे दो हिसाब रखते थे: एक निकाले गए शहद का, एक खोए हुए छत्तों का। सिर्फ़ एक छत्ता दोनों में है।' },
        onFoundReveal: { en: 'The hive journal names one hive he never took honey from!', hi: 'छत्तों की डायरी में एक छत्ता है जिससे उन्होंने कभी शहद नहीं निकाला!' },
      },
      {
        stageIndex: 1, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 58, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 54, y: 42, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 80, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'If he never took honey from that hive, something else came from it.', hi: 'अगर उस छत्ते से शहद नहीं निकाला, तो उससे कुछ और आया होगा।' },
        decoderClue: { en: 'The journal gives a hive number and a year. Only one jar down here is labelled with both.', hi: 'डायरी में छत्ते का नंबर और एक साल दोनों हैं। नीचे सिर्फ़ एक मर्तबान पर दोनों लिखे हैं।' },
        onFoundReveal: { en: 'The labelled jar holds honey — and a folded note pressed to the glass!', hi: 'लेबल वाले मर्तबान में शहद है — और काँच से सटी एक मुड़ी हुई पर्ची!' },
      },
      {
        stageIndex: 2, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 40, shape: 'painting', isCorrect: true },
          { id: 'h2', x: 52, y: 62, shape: 'drawer', isCorrect: false },
          { id: 'h3', x: 78, y: 44, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The note is short and points somewhere in the house.', hi: 'पर्ची छोटी है और घर में कहीं इशारा करती है।' },
        decoderClue: { en: 'The note says "where the hive still blooms, above where I sat." Two things must be true: it is on the wall, and it shows flowers.', hi: 'पर्ची कहती है "जहाँ छत्ता आज भी खिलता है, जहाँ मैं बैठता था उसके ऊपर"। दो बातें सही होनी चाहिए: दीवार पर हो, और उसमें फूल हों।' },
        onFoundReveal: { en: 'Behind the flower painting is a small brass key!', hi: 'फूलों वाली पेंटिंग के पीछे एक छोटी पीतल की चाबी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'box', isCorrect: false },
          { id: 'h2', x: 54, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 80, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The brass key opens what he kept of his father.', hi: 'पीतल की चाबी उस चीज़ को खोलती है जो उन्होंने अपने पिता की सँभाली थी।' },
        decoderClue: { en: 'It must be big enough for tools and old enough to have a lock — so not a crate, and not a jar.', hi: 'वह इतनी बड़ी हो कि औज़ार समा जाएँ और इतनी पुरानी कि उसमें ताला हो — तो न बक्सा, न मर्तबान।' },
        onFoundReveal: { en: 'The old trunk opens, smelling of beeswax...', hi: 'पुराना संदूक खुलता है, मोम की महक के साथ...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the first jar of honey from the hive his father started, saved for a day worth opening it.',
      hi: 'अंदर उस छत्ते के शहद का पहला मर्तबान है जो उनके पिता ने शुरू किया था, किसी ख़ास दिन के लिए सँभाला हुआ।',
      emoji: '🍯',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_14', level: 'moderate',
    title_en: "The Potter's Broken Bowl", title_hi: 'कुम्हार का टूटा कटोरा',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 60, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 48, y: 42, shape: 'lantern', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 42, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The potter kept every piece she ever broke. One of them she kept differently.', hi: 'कुम्हार ने अपना हर टूटा टुकड़ा सँभाला था। एक को उन्होंने अलग तरह से रखा।' },
        decoderClue: { en: 'Broken pieces went into open crates. Only what she meant to mend was kept somewhere she could see it every day.', hi: 'टूटे टुकड़े खुले बक्सों में जाते थे। सिर्फ़ जिसे जोड़ना चाहती थीं, उसे वहाँ रखा जहाँ रोज़ दिख सके।' },
        onFoundReveal: { en: 'The glass jar holds shards of a single blue bowl!', hi: 'काँच के मर्तबान में एक नीले कटोरे के टुकड़े हैं!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 56, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 82, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'She must have written about the bowl she wanted to mend.', hi: 'जिस कटोरे को वे जोड़ना चाहती थीं, उसके बारे में ज़रूर लिखा होगा।' },
        decoderClue: { en: 'The shards are blue and there are seven. Only one entry in her book matches both the colour and the count.', hi: 'टुकड़े नीले हैं और सात हैं। उनकी किताब में सिर्फ़ एक जगह रंग और गिनती दोनों मिलते हैं।' },
        onFoundReveal: { en: 'Her book describes mending with gold, and names the tool she needs!', hi: 'उनकी किताब में सोने से जोड़ने का ज़िक्र है, और उस औज़ार का नाम भी!' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 60, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 52, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 78, y: 58, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The gold tool is stored below, out of everyone else’s reach.', hi: 'सोने वाला औज़ार नीचे रखा है, सबकी पहुँच से दूर।' },
        decoderClue: { en: 'Gold is precious and the tool is small — so it needs somewhere that shuts, but it is far too small for a trunk.', hi: 'सोना कीमती है और औज़ार छोटा — तो ऐसी जगह चाहिए जो बंद हो, पर संदूक के लिए वह बहुत छोटा है।' },
        onFoundReveal: { en: 'The drawer holds a tiny brush and a pot of gold lacquer!', hi: 'दराज़ में एक नन्हा ब्रश और सुनहरी लाख का बर्तन है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'workshop', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 42, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 44, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'With shards and gold together, find where she meant to do the work.', hi: 'टुकड़े और सोना दोनों लेकर ढूँढो कि वे यह काम कहाँ करना चाहती थीं।' },
        decoderClue: { en: 'Her book says the mending kit and the finished piece live together — in the only thing here with a lid and a lock.', hi: 'उनकी किताब कहती है कि जोड़ने का सामान और तैयार चीज़ साथ रहते हैं — यहाँ की इकलौती ऐसी चीज़ में जिसमें ढक्कन और ताला दोनों हों।' },
        onFoundReveal: { en: 'The lidded chest opens, and gold catches the lamplight...', hi: 'ढक्कन वाला संदूक खुलता है, और सोना दीये की रोशनी में चमक उठता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is a bowl she already mended once — the gold seams show exactly where it broke, and she made it more beautiful than before.',
      hi: 'अंदर वह कटोरा है जिसे वे पहले ही एक बार जोड़ चुकी थीं — सुनहरी लकीरें बताती हैं कि वह कहाँ टूटा था, और उन्होंने उसे पहले से भी सुंदर बना दिया।',
      emoji: '🏺',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_15', level: 'moderate',
    title_en: "The Schoolteacher's Bell", title_hi: 'अध्यापिका की घंटी',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'library', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 56, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 74, y: 58, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 40, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'Forty years of teaching, and she kept every register.', hi: 'चालीस साल पढ़ाया, और उन्होंने हर रजिस्टर सँभाला।' },
        decoderClue: { en: 'She marked two things beside each name: attendance, and a small star. One register has stars beside every single name.', hi: 'वे हर नाम के आगे दो चीज़ें लिखती थीं: हाज़िरी, और एक छोटा तारा। एक रजिस्टर में हर नाम के आगे तारा है।' },
        onFoundReveal: { en: 'The starred register is from her very last year!', hi: 'तारों वाला रजिस्टर उनके आख़िरी साल का है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 60, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 56, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 82, y: 58, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'Her last year must have ended with something kept.', hi: 'उनके आख़िरी साल के अंत में कुछ तो सँभाला गया होगा।' },
        decoderClue: { en: 'The register lists a date and a room number. Both together match a label on only one thing at her desk.', hi: 'रजिस्टर में एक तारीख़ और कमरा नंबर दोनों हैं। दोनों मिलकर उनकी मेज़ पर सिर्फ़ एक चीज़ के लेबल से मिलते हैं।' },
        onFoundReveal: { en: 'The labelled drawer holds a small iron key and a class photograph!', hi: 'लेबल वाले दराज़ में एक छोटी लोहे की चाबी और क्लास की तस्वीर है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'attic', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 44, shape: 'box', isCorrect: true },
          { id: 'h2', x: 52, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 78, y: 42, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The photograph shows the classroom. Something in it is up here now.', hi: 'तस्वीर में क्लासरूम है। उसमें की एक चीज़ अब यहाँ ऊपर है।' },
        decoderClue: { en: 'In the photo she is holding something small and metal, and it is packed in wood — not glass, not iron.', hi: 'तस्वीर में उनके हाथ में कुछ छोटा और धातु का है, और वह लकड़ी में पैक है — न काँच में, न लोहे में।' },
        onFoundReveal: { en: 'The wooden box holds the school bell, wrapped in cloth!', hi: 'लकड़ी के बक्से में स्कूल की घंटी है, कपड़े में लिपटी!' },
      },
      {
        stageIndex: 3, sceneTheme: 'library', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 58, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 80, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The iron key still has not been used. One thing here is still locked.', hi: 'लोहे की चाबी अब तक इस्तेमाल नहीं हुई। यहाँ एक चीज़ अब भी बंद है।' },
        decoderClue: { en: 'It must be old enough to need an iron key and large enough to hold forty years — so not a drawer, and not on a wall.', hi: 'वह इतनी पुरानी हो कि लोहे की चाबी चाहिए और इतनी बड़ी कि चालीस साल समा जाएँ — तो न दराज़, न दीवार पर।' },
        onFoundReveal: { en: 'The locked chest opens on a stack of paper...', hi: 'बंद संदूक कागज़ों के ढेर पर खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside are letters from students who wrote back years later, to tell her what they became.',
      hi: 'अंदर उन छात्रों की चिट्ठियाँ हैं जिन्होंने सालों बाद लिखकर बताया कि वे क्या बने।',
      emoji: '🔔',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_16', level: 'moderate',
    title_en: "The Watchman's Rounds", title_hi: 'चौकीदार का गश्त',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h4', x: 88, y: 44, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The night watchman walked the same rounds for thirty years. He logged every one.', hi: 'रात का चौकीदार तीस साल एक ही गश्त लगाता रहा। हर गश्त लिखी।' },
        decoderClue: { en: 'He noted the time he passed each door and the weather. Only one night has a time with no weather beside it.', hi: 'वे हर दरवाज़े से गुज़रने का समय और मौसम लिखते थे। सिर्फ़ एक रात ऐसी है जिसमें समय है पर मौसम नहीं।' },
        onFoundReveal: { en: 'The round book shows a night he stopped halfway!', hi: 'गश्त की किताब में एक रात है जब वे बीच में ही रुक गए!' },
      },
      {
        stageIndex: 1, sceneTheme: 'workshop', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 42, shape: 'lantern', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 42, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'He stopped halfway for a reason. What did he carry with him?', hi: 'वे किसी वजह से बीच में रुके। उनके साथ क्या रहता था?' },
        decoderClue: { en: 'The book says he stopped when two things happened together: the wind rose, and his light went out.', hi: 'किताब कहती है कि वे तब रुके जब दो बातें एक साथ हुईं: हवा तेज़ हुई, और उनकी रोशनी बुझ गई।' },
        onFoundReveal: { en: 'His lantern still has the burnt-out wick from that night!', hi: 'उनकी लालटेन में आज भी उसी रात की जली हुई बत्ती है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 60, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 52, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 78, y: 44, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'Something happened that night that he never wrote down.', hi: 'उस रात कुछ हुआ जो उन्होंने कभी नहीं लिखा।' },
        decoderClue: { en: 'When his light went out he found something on the path. It was small and it was not his — so he put it where lost things waited, behind a handle.', hi: 'रोशनी बुझने पर उन्हें रास्ते में कुछ मिला। वह छोटा था और उनका नहीं था — तो उन्होंने उसे वहाँ रखा जहाँ खोई चीज़ें इंतज़ार करती हैं, हैंडल के पीछे।' },
        onFoundReveal: { en: 'In the drawer is a child’s toy and a note: "waiting to be claimed."', hi: 'दराज़ में एक बच्चे का खिलौना और पर्ची है: "मालिक के इंतज़ार में"।' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 42, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'Nobody ever claimed it. Find where he kept the rest.', hi: 'कोई कभी लेने नहीं आया। ढूँढो कि बाकी सब उन्होंने कहाँ रखा।' },
        decoderClue: { en: 'Thirty years of lost things needs room and a lid — and he marked it with a star so nobody threw it away.', hi: 'तीस साल की खोई चीज़ों के लिए जगह और ढक्कन दोनों चाहिए — और उन्होंने उस पर तारा बनाया ताकि कोई फेंक न दे।' },
        onFoundReveal: { en: 'The star-marked trunk opens on a lifetime of small things...', hi: 'तारे वाला संदूक ज़िंदगी भर की छोटी चीज़ों पर खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside are all the lost things he ever found and kept safe, each with a note, hoping someone would come back for them.',
      hi: 'अंदर वे सारी खोई चीज़ें हैं जो उन्हें मिलीं और उन्होंने सँभालीं, हर एक पर एक पर्ची, इस उम्मीद में कि कोई लौटकर आएगा।',
      emoji: '🏮',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_17', level: 'moderate',
    title_en: "The Tailor's Thread", title_hi: 'दर्ज़ी का धागा',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 42, shape: 'box', isCorrect: true },
          { id: 'h2', x: 48, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 74, y: 42, shape: 'lantern', isCorrect: false },
          { id: 'h4', x: 88, y: 62, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The tailor measured half the town. One set of measurements he never used.', hi: 'दर्ज़ी ने आधे शहर का नाप लिया। एक नाप उन्होंने कभी इस्तेमाल नहीं किया।' },
        decoderClue: { en: 'Working measurements stayed on the bench; finished ones went in the book. The unused one is in neither — it is boxed.', hi: 'चालू नाप मेज़ पर रहते थे; पूरे हुए किताब में जाते थे। बिना इस्तेमाल वाला दोनों में नहीं — वह डिब्बे में है।' },
        onFoundReveal: { en: 'The box holds a measuring tape and a folded order slip!', hi: 'डिब्बे में एक नापने का फीता और मुड़ी हुई पर्ची है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h2', x: 56, y: 60, shape: 'notebook', isCorrect: true },
          { id: 'h3', x: 82, y: 42, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The order slip has no name. His records might say who it was for.', hi: 'पर्ची पर कोई नाम नहीं। उनके रिकॉर्ड बता सकते हैं कि यह किसके लिए थी।' },
        decoderClue: { en: 'The slip has a date and a fabric. Only one entry in his ledger has both — and the name beside it is his own son.', hi: 'पर्ची पर एक तारीख़ और कपड़ा है। उनकी बही में सिर्फ़ एक जगह दोनों हैं — और उसके आगे नाम उनके अपने बेटे का है।' },
        onFoundReveal: { en: 'The ledger names the coat he was making for his son’s wedding!', hi: 'बही में उस कोट का ज़िक्र है जो वे अपने बेटे की शादी के लिए बना रहे थे!' },
      },
      {
        stageIndex: 2, sceneTheme: 'garden-shed', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 44, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 52, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 78, y: 42, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The coat needed one thread he could not buy.', hi: 'उस कोट के लिए एक धागा चाहिए था जो वे खरीद नहीं सकते थे।' },
        decoderClue: { en: 'He dyed the thread himself out here, and kept anything still wet in glass — the ledger says it never dried in time.', hi: 'वे धागा यहीं खुद रंगते थे, और जो अब भी गीला हो वह काँच में रखते थे — बही कहती है कि वह समय पर कभी सूखा ही नहीं।' },
        onFoundReveal: { en: 'The jar holds a spool of deep red thread — and a small key!', hi: 'मर्तबान में गहरे लाल धागे की रील है — और एक छोटी चाबी!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'box', isCorrect: false },
          { id: 'h2', x: 54, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 80, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The coat itself must be somewhere safe.', hi: 'कोट खुद कहीं सुरक्षित रखा होगा।' },
        decoderClue: { en: 'A coat needs to hang flat and stay dry — so something long, with a lid, and a lock this key fits.', hi: 'कोट सीधा और सूखा रहना चाहिए — तो कुछ लंबा, ढक्कन वाला, और जिसमें यह चाबी लगे।' },
        onFoundReveal: { en: 'The long trunk opens on folded cloth...', hi: 'लंबा संदूक तह किए कपड़े पर खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the wedding coat he finished after all, with the red thread stitched into the lining where only his son would find it.',
      hi: 'अंदर वह शादी का कोट है जो उन्होंने आख़िरकार पूरा किया, लाल धागा अस्तर में वहाँ सिला जहाँ सिर्फ़ उनका बेटा उसे पाता।',
      emoji: '🧵',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_18', level: 'moderate',
    title_en: "The Photographer's Darkroom", title_hi: 'फ़ोटोग्राफ़र का डार्करूम',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 44, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 48, y: 60, shape: 'drawer', isCorrect: false },
          { id: 'h3', x: 74, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h4', x: 88, y: 62, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'The darkroom is warm and still. One roll of film was never developed.', hi: 'डार्करूम गर्म और शांत है। एक रोल कभी डेवलप नहीं हुआ।' },
        decoderClue: { en: 'Developed film went into envelopes; undeveloped film had to stay sealed and away from light — so glass with a lid, not paper.', hi: 'डेवलप हुई फ़िल्म लिफ़ाफ़ों में जाती थी; बिना डेवलप वाली सील और रोशनी से दूर रहनी चाहिए — तो ढक्कन वाला काँच, कागज़ नहीं।' },
        onFoundReveal: { en: 'The sealed jar holds one roll of film, labelled with a single word!', hi: 'सील बंद मर्तबान में एक रोल है, जिस पर सिर्फ़ एक शब्द लिखा है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 56, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 82, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'One word is not much to go on. He must have explained it somewhere.', hi: 'एक शब्द से क्या पता चले। उन्होंने कहीं तो समझाया होगा।' },
        decoderClue: { en: 'He logged every roll by word and by year. Only one line in his book has that word and a year with no photograph beside it.', hi: 'वे हर रोल को शब्द और साल से लिखते थे। उनकी किताब में सिर्फ़ एक लाइन में वह शब्द और ऐसा साल है जिसके आगे कोई तस्वीर नहीं।' },
        onFoundReveal: { en: 'His log says the roll was never developed because he was afraid to see it!', hi: 'उनकी किताब कहती है कि रोल इसलिए डेवलप नहीं हुआ क्योंकि उन्हें देखने से डर लगता था!' },
      },
      {
        stageIndex: 2, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 60, shape: 'box', isCorrect: true },
          { id: 'h2', x: 52, y: 42, shape: 'lantern', isCorrect: false },
          { id: 'h3', x: 78, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'To develop it, you need what he stopped using that year.', hi: 'उसे डेवलप करने के लिए वह चाहिए जो उन्होंने उस साल इस्तेमाल करना छोड़ दिया।' },
        decoderClue: { en: 'His chemicals are packed away in wood, and the crate he wants is the one with the same year written on the side.', hi: 'उनके रसायन लकड़ी में पैक हैं, और जो बक्सा चाहिए उस पर किनारे वही साल लिखा है।' },
        onFoundReveal: { en: 'The dated crate holds developing trays — and a small key taped inside!', hi: 'तारीख़ वाले बक्से में डेवलपिंग ट्रे हैं — और अंदर चिपकी एक छोटी चाबी!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 42, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 44, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The key opens what he could not throw away.', hi: 'चाबी उस चीज़ को खोलती है जिसे वे फेंक नहीं सके।' },
        decoderClue: { en: 'It holds prints, so it must be flat and dry and shut — and it is the only thing here that needs a key at all.', hi: 'उसमें तस्वीरें हैं, तो वह सपाट, सूखी और बंद होनी चाहिए — और यहाँ सिर्फ़ उसी को चाबी चाहिए।' },
        onFoundReveal: { en: 'The chest opens on stacks of photographs...', hi: 'संदूक तस्वीरों के ढेर पर खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside are the photographs of his family he never dared develop — every one of them happy.',
      hi: 'अंदर उनके परिवार की वे तस्वीरें हैं जिन्हें डेवलप करने की उनकी हिम्मत नहीं हुई — और हर तस्वीर में सब खुश हैं।',
      emoji: '📷',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_19', level: 'moderate',
    title_en: "The Blacksmith's Small Shoe", title_hi: 'लोहार का छोटा नाल',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 60, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 42, shape: 'lantern', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 42, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The forge is cold now, but the blacksmith kept count of everything he made.', hi: 'भट्ठी अब ठंडी है, पर लोहार ने अपनी बनाई हर चीज़ का हिसाब रखा।' },
        decoderClue: { en: 'He listed the horse and the size for every shoe. One entry has a size but no horse.', hi: 'वे हर नाल के लिए घोड़े का नाम और नाप लिखते थे। एक जगह नाप है पर घोड़ा नहीं।' },
        onFoundReveal: { en: 'The forge book shows a shoe made far too small for any horse!', hi: 'भट्ठी की किताब में एक नाल है जो किसी भी घोड़े के लिए बहुत छोटा है!' },
      },
      {
        stageIndex: 1, sceneTheme: 'garden-shed', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 44, shape: 'box', isCorrect: true },
          { id: 'h2', x: 56, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 82, y: 44, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'Something that small was made for something small. Look where the animals were kept.', hi: 'इतनी छोटी चीज़ किसी छोटे के लिए बनी थी। देखो जहाँ जानवर रखे जाते थे।' },
        decoderClue: { en: 'The book gives a size and a year. Only one thing out here is marked with both — packed in wood, not glass.', hi: 'किताब में नाप और साल दोनों हैं। यहाँ सिर्फ़ एक चीज़ पर दोनों लिखे हैं — लकड़ी में पैक, काँच में नहीं।' },
        onFoundReveal: { en: 'The crate holds a tiny bridle, sized for a pony!', hi: 'बक्से में एक नन्ही लगाम है, टट्टू के नाप की!' },
      },
      {
        stageIndex: 2, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 40, shape: 'painting', isCorrect: true },
          { id: 'h2', x: 52, y: 62, shape: 'drawer', isCorrect: false },
          { id: 'h3', x: 78, y: 44, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'A pony this small must have belonged to someone he loved.', hi: 'इतना छोटा टट्टू ज़रूर किसी अपने का रहा होगा।' },
        decoderClue: { en: 'He never wrote her name, but he hung her where he could see her — and she is the only thing here with an animal in it.', hi: 'उन्होंने उसका नाम कभी नहीं लिखा, पर उसे वहाँ टाँगा जहाँ देख सकें — और यहाँ सिर्फ़ उसी में कोई जानवर है।' },
        onFoundReveal: { en: 'The painting shows a child on a pony — with a key hooked behind the frame!', hi: 'पेंटिंग में एक बच्चा टट्टू पर है — और फ़्रेम के पीछे एक चाबी अटकी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 58, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 54, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 80, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The key from the frame opens the last thing he locked.', hi: 'फ़्रेम वाली चाबी उस आख़िरी चीज़ को खोलती है जिसे उन्होंने बंद किया।' },
        decoderClue: { en: 'Iron must stay dry, and he kept it low and covered — so a lid, and brass corners, not an open drawer.', hi: 'लोहा सूखा रहना चाहिए, और उन्होंने उसे नीचे ढककर रखा — तो ढक्कन और पीतल के कोने, खुला दराज़ नहीं।' },
        onFoundReveal: { en: 'The trunk opens, and metal gleams softly...', hi: 'संदूक खुलता है, और धातु हल्के से चमकती है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the first shoe he ever made for his daughter’s pony, kept long after both had grown old.',
      hi: 'अंदर वह पहला नाल है जो उन्होंने अपनी बेटी के टट्टू के लिए बनाया था, दोनों के बूढ़े हो जाने के बाद भी सँभाला हुआ।',
      emoji: '🐴',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'mod_20', level: 'moderate',
    title_en: "The Storyteller's Trunk", title_hi: 'कहानीकार का संदूक',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'library', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h2', x: 48, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h3', x: 74, y: 42, shape: 'lantern', isCorrect: false },
          { id: 'h4', x: 88, y: 60, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'She told stories in the square every week and never read from a book.', hi: 'वे हर हफ़्ते चौक में कहानियाँ सुनाती थीं और कभी किताब से नहीं पढ़ती थीं।' },
        decoderClue: { en: 'She wrote nothing down for the crowd — only for herself. Her own writing is by hand, never printed.', hi: 'भीड़ के लिए वे कुछ नहीं लिखती थीं — सिर्फ़ अपने लिए। उनका अपना लिखा हाथ का है, छपा हुआ कभी नहीं।' },
        onFoundReveal: { en: 'The handwritten notebook lists story titles — one has never been told!', hi: 'हाथ से लिखी नोटबुक में कहानियों के नाम हैं — एक कभी सुनाई नहीं गई!' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 60, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 56, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 82, y: 58, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'An untold story must exist somewhere in her house.', hi: 'बिन सुनाई कहानी उनके घर में कहीं तो होगी।' },
        decoderClue: { en: 'The title has a word and a number. Both together match the label on one small thing at her writing desk.', hi: 'नाम में एक शब्द और एक नंबर है। दोनों मिलकर उनकी लिखने की मेज़ की एक छोटी चीज़ के लेबल से मिलते हैं।' },
        onFoundReveal: { en: 'The drawer holds loose pages — and the last page is missing!', hi: 'दराज़ में खुले पन्ने हैं — और आख़िरी पन्ना गायब है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'garden-shed', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 42, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 52, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 78, y: 44, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'She hid endings. She always said an ending should be earned.', hi: 'वे अंत छिपाती थीं। हमेशा कहती थीं कि अंत कमाया जाना चाहिए।' },
        decoderClue: { en: 'Paper must stay dry outdoors, and she wanted to see it was still there — so glass with a lid, not a wooden crate.', hi: 'बाहर कागज़ सूखा रहना चाहिए, और वे देखना चाहती थीं कि वह अब भी है — तो ढक्कन वाला काँच, लकड़ी का बक्सा नहीं।' },
        onFoundReveal: { en: 'The jar holds the missing last page, rolled tight!', hi: 'मर्तबान में गुम आख़िरी पन्ना है, कसकर लिपटा हुआ!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'box', isCorrect: false },
          { id: 'h2', x: 54, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 80, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The last page names where every story lives.', hi: 'आख़िरी पन्ना बताता है कि हर कहानी कहाँ रहती है।' },
        decoderClue: { en: 'The page says "under the star, behind the lid" — two things must be true, and only one thing up here is both.', hi: 'पन्ना कहता है "तारे के नीचे, ढक्कन के पीछे" — दो बातें सही होनी चाहिए, और यहाँ सिर्फ़ एक चीज़ में दोनों हैं।' },
        onFoundReveal: { en: 'The star-marked trunk creaks open...', hi: 'तारे वाला संदूक चरचराते हुए खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside are all the stories she made up for the village children, written down at last so they would not be lost.',
      hi: 'अंदर वे सारी कहानियाँ हैं जो उन्होंने गाँव के बच्चों के लिए गढ़ी थीं, आख़िरकार लिख दी गईं ताकि खो न जाएँ।',
      emoji: '📜',
    },
    facilitatorQuestions: FQ,
  },

  {
    id: 'adv_21', level: 'advanced',
    title_en: "The Astronomer's Constellation", title_hi: 'खगोलशास्त्री का तारामंडल',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 38, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'lantern', isCorrect: false },
          { id: 'h4', x: 88, y: 40, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The astronomer recorded every clear night of his life. Remember what you find here — you will need it later.', hi: 'खगोलशास्त्री ने अपनी ज़िंदगी की हर साफ़ रात लिखी। जो यहाँ मिले उसे याद रखना — आगे काम आएगा।' },
        decoderClue: { en: 'He observed with instruments but he thought on paper — and thinking was always done by hand.', hi: 'वे यंत्रों से देखते थे पर सोचते कागज़ पर थे — और सोचना हमेशा हाथ से होता था।' },
        onFoundReveal: { en: 'His notebook falls open at page 12: a constellation he drew but never named.', hi: 'उनकी नोटबुक पन्ना 12 पर खुलती है: एक तारामंडल जो उन्होंने बनाया पर नाम नहीं दिया।' },
      },
      {
        stageIndex: 1, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 42, shape: 'box', isCorrect: true },
          { id: 'h2', x: 54, y: 62, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 80, y: 40, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The observatory loft still holds his instruments.', hi: 'वेधशाला की अटारी में आज भी उनके यंत्र हैं।' },
        decoderClue: { en: 'Think about what your partner found in the study: the constellation on page 12 has seven stars. Only one thing up here has seven marks burned into its side.', hi: 'सोचो कि तुम्हारे साथी को अध्ययन कक्ष में क्या मिला: पन्ना 12 के तारामंडल में सात तारे हैं। यहाँ सिर्फ़ एक चीज़ के किनारे सात निशान जले हुए हैं।' },
        onFoundReveal: { en: 'The seven-marked case holds a lens, and a slip of paper with a symbol!', hi: 'सात निशान वाले डिब्बे में एक लेंस है, और एक पर्ची जिस पर एक चिन्ह है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'library', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 58, shape: 'notebook', isCorrect: false },
          { id: 'h2', x: 52, y: 40, shape: 'painting', isCorrect: true },
          { id: 'h3', x: 78, y: 60, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'The symbol from the lens case must mean something in the library.', hi: 'लेंस के डिब्बे वाले चिन्ह का पुस्तकालय में कुछ मतलब होगा।' },
        decoderClue: { en: 'The symbol is the same shape as the constellation your partner found on page 12 — and only one thing in this room shows a night sky.', hi: 'वह चिन्ह उसी तारामंडल जैसा है जो तुम्हारे साथी को पन्ना 12 पर मिला — और इस कमरे में सिर्फ़ एक चीज़ में रात का आसमान है।' },
        onFoundReveal: { en: 'Behind the night-sky painting is a small iron key!', hi: 'रात के आसमान वाली पेंटिंग के पीछे एक छोटी लोहे की चाबी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 58, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 54, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 80, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'One last locked thing remains.', hi: 'एक आख़िरी बंद चीज़ बाकी है।' },
        decoderClue: { en: 'Remember the star he carved on everything that mattered to him — the case, the page, the frame. The last thing carries it too, and it needs the iron key.', hi: 'याद करो वह तारा जो वे हर अहम चीज़ पर बनाते थे — डिब्बा, पन्ना, फ़्रेम। आख़िरी चीज़ पर भी वही है, और उसे लोहे की चाबी चाहिए।' },
        onFoundReveal: { en: 'The star-marked chest opens under the lamplight...', hi: 'तारे वाला संदूक दीये की रोशनी में खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the star chart where he finally named that constellation — after his daughter, who used to watch the sky with him.',
      hi: 'अंदर वह तारा-नक्शा है जहाँ उन्होंने आख़िरकार उस तारामंडल का नाम रखा — अपनी बेटी के नाम पर, जो उनके साथ आसमान देखती थी।',
      emoji: '✨',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_22', level: 'advanced',
    title_en: "The Mapmaker's First Street", title_hi: 'नक्शानवीस की पहली गली',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 56, shape: 'map', isCorrect: true },
          { id: 'h2', x: 48, y: 38, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'drawer', isCorrect: false },
          { id: 'h4', x: 88, y: 40, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The mapmaker drew half the country. Notice the details here — they come back.', hi: 'नक्शानवीस ने आधा देश बनाया। यहाँ की बातें ध्यान से देखो — वे लौटकर आएँगी।' },
        decoderClue: { en: 'He never folded a finished map; he rolled it. Only a rolled one is truly his own work.', hi: 'वे तैयार नक्शा कभी मोड़ते नहीं थे; लपेटते थे। सिर्फ़ लपेटा हुआ ही उनका अपना काम है।' },
        onFoundReveal: { en: 'The rolled map is signed with a compass drawn in the corner — pointing south, not north.', hi: 'लपेटे नक्शे के कोने में एक कम्पास बना है — दक्षिण की ओर, उत्तर की नहीं।' },
      },
      {
        stageIndex: 1, sceneTheme: 'workshop', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 54, y: 42, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 80, y: 60, shape: 'box', isCorrect: false },
        ],
        searcherPrompt: { en: 'His drafting room is where the work was actually done.', hi: 'उनका ड्राफ़्टिंग कमरा वहीं है जहाँ असल काम होता था।' },
        decoderClue: { en: 'Your partner found a compass pointing south — that was his private mark, never used for clients. His private work stayed behind a handle, not on the bench.', hi: 'तुम्हारे साथी को दक्षिण की ओर कम्पास मिला — यह उनका निजी निशान था, ग्राहकों के लिए कभी नहीं। निजी काम हैंडल के पीछे रहता था, मेज़ पर नहीं।' },
        onFoundReveal: { en: 'The drawer holds three rolled maps, all signed pointing south!', hi: 'दराज़ में तीन लपेटे नक्शे हैं, तीनों पर दक्षिण वाला निशान!' },
      },
      {
        stageIndex: 2, sceneTheme: 'attic', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 44, shape: 'box', isCorrect: true },
          { id: 'h2', x: 52, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 78, y: 42, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'Three private maps, and one place they all point to.', hi: 'तीन निजी नक्शे, और एक जगह जिस पर तीनों इशारा करते हैं।' },
        decoderClue: { en: 'All three maps show the same street corner. The thing that holds his oldest work is the one made of wood, like the desk in the first map.', hi: 'तीनों नक्शों में वही गली का मोड़ है। जिसमें उनका सबसे पुराना काम है वह लकड़ी की है, पहले नक्शे की मेज़ जैसी।' },
        onFoundReveal: { en: 'The wooden case holds a child’s drawing and a small key!', hi: 'लकड़ी के डिब्बे में एक बच्चे की ड्राइंग और एक छोटी चाबी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'library', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h2', x: 54, y: 58, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 80, y: 42, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The child’s drawing and the key belong together somewhere.', hi: 'बच्चे की ड्राइंग और चाबी कहीं एक साथ हैं।' },
        decoderClue: { en: 'Every private thing he owned carried the south-pointing compass your partner spotted first. Only one thing here has it, and it needs a key.', hi: 'उनकी हर निजी चीज़ पर वही दक्षिण वाला कम्पास था जो तुम्हारे साथी ने सबसे पहले देखा। यहाँ सिर्फ़ एक चीज़ पर वह है, और उसे चाबी चाहिए।' },
        onFoundReveal: { en: 'The compass-marked chest opens quietly...', hi: 'कम्पास वाला संदूक चुपचाप खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the first map he ever drew, aged seven — his own street, with his house marked in crayon.',
      hi: 'अंदर उनका बनाया सबसे पहला नक्शा है, सात साल की उम्र का — अपनी ही गली, और अपना घर क्रेयॉन से बना हुआ।',
      emoji: '🗺️',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_23', level: 'advanced',
    title_en: "The Composer's Unwritten Ending", title_hi: 'संगीतकार का अनलिखा अंत',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'library', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 74, y: 58, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 42, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The composer left one piece unfinished. Pay attention to the numbers you find.', hi: 'संगीतकार ने एक रचना अधूरी छोड़ी। जो नंबर मिलें उन पर ध्यान देना।' },
        decoderClue: { en: 'Published work was printed; anything unfinished stayed in his own hand.', hi: 'छपा हुआ काम प्रकाशित था; अधूरा सब उनके अपने हाथ का रहा।' },
        onFoundReveal: { en: 'The handwritten score stops at bar 34 — mid-phrase.', hi: 'हाथ से लिखी रचना बार 34 पर रुक जाती है — वाक्य के बीच में।' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 30, y: 60, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 56, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 82, y: 58, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'He stopped for a reason, and he kept the reason close.', hi: 'वे किसी वजह से रुके, और वह वजह पास ही रखी।' },
        decoderClue: { en: 'Your partner found the score stops at bar 34. He numbered everything he owned — look for the small thing labelled 34.', hi: 'तुम्हारे साथी को मिला कि रचना बार 34 पर रुकती है। वे अपनी हर चीज़ पर नंबर डालते थे — 34 वाली छोटी चीज़ ढूँढो।' },
        onFoundReveal: { en: 'Drawer 34 holds a letter, unopened, and a small key.', hi: 'दराज़ 34 में एक बिन खुली चिट्ठी और एक छोटी चाबी है।' },
      },
      {
        stageIndex: 2, sceneTheme: 'attic', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 42, shape: 'box', isCorrect: true },
          { id: 'h2', x: 52, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 78, y: 44, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The letter was never opened. Whatever it was about is stored up here.', hi: 'चिट्ठी कभी नहीं खुली। वह जिस बारे में थी, वह यहाँ ऊपर रखा है।' },
        decoderClue: { en: 'The letter is dated the same year printed on only one crate up here — and it is wood, like the case the score was kept in.', hi: 'चिट्ठी पर वही साल है जो यहाँ सिर्फ़ एक बक्से पर छपा है — और वह लकड़ी का है, उसी डिब्बे जैसा जिसमें रचना रखी थी।' },
        onFoundReveal: { en: 'The crate holds concert programmes — every one from the same hall.', hi: 'बक्से में कॉन्सर्ट के प्रोग्राम हैं — सब उसी हॉल के।' },
      },
      {
        stageIndex: 3, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 54, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h3', x: 80, y: 58, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The key from drawer 34 has not been used yet.', hi: 'दराज़ 34 वाली चाबी अभी इस्तेमाल नहीं हुई।' },
        decoderClue: { en: 'Everything of his that mattered was numbered, and your partner found the programmes all name one hall. The thing here marked with that same number 34 is the only one with a lock.', hi: 'उनकी हर अहम चीज़ पर नंबर था, और तुम्हारे साथी को मिला कि सारे प्रोग्राम एक ही हॉल के हैं। यहाँ उसी नंबर 34 वाली चीज़ ही इकलौती है जिसमें ताला है।' },
        onFoundReveal: { en: 'Chest 34 opens with a soft creak...', hi: 'संदूक 34 हल्की चरचराहट के साथ खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the ending he wrote years later, on the night he finally forgave himself — bar 35 onwards, in a steadier hand.',
      hi: 'अंदर वह अंत है जो उन्होंने सालों बाद लिखा, उस रात जब उन्होंने आख़िरकार खुद को माफ़ किया — बार 35 से आगे, कहीं ज़्यादा स्थिर हाथ से।',
      emoji: '🎼',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_24', level: 'advanced',
    title_en: "The Botanist's Pressed Flowers", title_hi: 'वनस्पतिशास्त्री के दबाए फूल',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'garden-shed', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 44, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 62, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 74, y: 42, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 62, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The botanist named hundreds of plants. Remember any names you see.', hi: 'वनस्पतिशास्त्री ने सैकड़ों पौधों के नाम रखे। जो नाम दिखें, याद रखना।' },
        decoderClue: { en: 'Specimens were labelled in print, but her thinking was always in her own field book.', hi: 'नमूनों के लेबल छपे थे, पर उनकी सोच हमेशा अपनी फ़ील्ड बुक में रहती थी।' },
        onFoundReveal: { en: 'The field book names one flower she found only once, in 1961: "Amara".', hi: 'फ़ील्ड बुक में एक फूल है जो उन्हें सिर्फ़ एक बार 1961 में मिला: "अमरा"।' },
      },
      {
        stageIndex: 1, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 58, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 54, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 80, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'Her specimen store is down here, cool and dry.', hi: 'उनका नमूना भंडार यहाँ नीचे है, ठंडा और सूखा।' },
        decoderClue: { en: 'Your partner found the flower was called Amara and was found in 1961. Only one container here carries both that name and that year.', hi: 'तुम्हारे साथी को मिला कि फूल का नाम अमरा है और वह 1961 में मिला। यहाँ सिर्फ़ एक डिब्बे पर वह नाम और वह साल दोनों हैं।' },
        onFoundReveal: { en: 'The Amara jar is empty — but a note inside says "moved, see the wall".', hi: 'अमरा का मर्तबान खाली है — पर अंदर पर्ची है: "हटा दिया, दीवार देखो"।' },
      },
      {
        stageIndex: 2, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 40, shape: 'painting', isCorrect: true },
          { id: 'h2', x: 52, y: 62, shape: 'drawer', isCorrect: false },
          { id: 'h3', x: 78, y: 44, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The note says the wall. Something on the wall is hiding it.', hi: 'पर्ची कहती है दीवार। दीवार पर कुछ उसे छिपाए है।' },
        decoderClue: { en: 'She pressed Amara rather than keeping it in glass, and pressed flowers get framed — the only framed thing here is on the wall.', hi: 'उन्होंने अमरा को काँच में रखने के बजाय दबाया, और दबाए फूल फ़्रेम होते हैं — यहाँ इकलौती फ़्रेम वाली चीज़ दीवार पर है।' },
        onFoundReveal: { en: 'Behind the frame is a pressed flower and a tiny key!', hi: 'फ़्रेम के पीछे एक दबाया हुआ फूल और नन्ही चाबी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 62, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 42, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'One thing remains locked.', hi: 'एक चीज़ अब भी बंद है।' },
        decoderClue: { en: 'Remember the year your partner read out — 1961. The locked thing carries that year, and pressed sheets need something flat with a lid.', hi: 'याद करो वह साल जो तुम्हारे साथी ने बताया — 1961। बंद चीज़ पर वही साल है, और दबाए पन्नों के लिए ढक्कन वाली सपाट चीज़ चाहिए।' },
        onFoundReveal: { en: 'The 1961 chest opens on paper thin as breath...', hi: '1961 वाला संदूक साँस जैसे पतले कागज़ों पर खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is every flower her husband ever picked for her, pressed and dated — including Amara, from the day they met.',
      hi: 'अंदर वे सारे फूल हैं जो उनके पति ने कभी उनके लिए तोड़े, दबाए और तारीख़ लिखे हुए — अमरा भी, उसी दिन का जब वे पहली बार मिले थे।',
      emoji: '🌸',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_25', level: 'advanced',
    title_en: "The Puppeteer's Last Show", title_hi: 'कठपुतली वाले का आख़िरी खेल',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 60, shape: 'box', isCorrect: true },
          { id: 'h2', x: 48, y: 42, shape: 'lantern', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h4', x: 88, y: 42, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'Every puppet he made is boxed and numbered. Remember the numbers.', hi: 'उनकी बनाई हर कठपुतली डिब्बे में है और नंबर लगी है। नंबर याद रखना।' },
        decoderClue: { en: 'Puppets live in wood, tools live on the bench. The one that matters is boxed and its number is missing from the shelf list.', hi: 'कठपुतलियाँ लकड़ी में रहती हैं, औज़ार मेज़ पर। जो अहम है वह डिब्बे में है और उसका नंबर शेल्फ़ की सूची से गायब है।' },
        onFoundReveal: { en: 'Box 9 holds a puppet with no strings attached — and a playbill.', hi: 'डिब्बा 9 में एक कठपुतली है जिसमें डोरियाँ नहीं — और एक पर्चा।' },
      },
      {
        stageIndex: 1, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 42, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 44, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'A puppet with no strings cannot perform. Find the strings.', hi: 'बिना डोरी की कठपुतली खेल नहीं दिखा सकती। डोरियाँ ढूँढो।' },
        decoderClue: { en: 'Your partner found puppet number 9. He wound each puppet’s strings separately and kept them where he could count them without opening anything.', hi: 'तुम्हारे साथी को कठपुतली नंबर 9 मिली। वे हर कठपुतली की डोरियाँ अलग लपेटते थे और वहाँ रखते थे जहाँ बिना खोले गिनी जा सकें।' },
        onFoundReveal: { en: 'The jar marked 9 holds a bundle of strings and a folded note!', hi: '9 लिखे मर्तबान में डोरियों का गुच्छा और एक मुड़ी पर्ची है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'library', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 52, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 78, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The note is a single line of a script. Find the rest.', hi: 'पर्ची में स्क्रिप्ट की एक ही लाइन है। बाकी ढूँढो।' },
        decoderClue: { en: 'The playbill your partner found names show 9. He wrote every script by hand — find the handwritten one, not the printed ones.', hi: 'तुम्हारे साथी को मिला पर्चा खेल 9 का है। वे हर स्क्रिप्ट हाथ से लिखते थे — हाथ से लिखी ढूँढो, छपी हुई नहीं।' },
        onFoundReveal: { en: 'The script for show 9 ends with a stage direction: "give it to her" — and a key falls out!', hi: 'खेल 9 की स्क्रिप्ट एक हिदायत पर खत्म होती है: "यह उसे दे देना" — और एक चाबी गिर पड़ती है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 80, y: 58, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: '"Give it to her." Find what he meant to give.', hi: '"यह उसे दे देना।" ढूँढो कि वे क्या देना चाहते थे।' },
        decoderClue: { en: 'The number 9 has followed you all the way — the box, the strings, the script. The only locked thing here carries it too.', hi: 'नंबर 9 शुरू से साथ चला आ रहा है — डिब्बा, डोरियाँ, स्क्रिप्ट। यहाँ इकलौती बंद चीज़ पर भी वही है।' },
        onFoundReveal: { en: 'Chest 9 opens...', hi: 'संदूक 9 खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the puppet he carved to look exactly like his granddaughter, for a show he never got to perform for her.',
      hi: 'अंदर वह कठपुतली है जिसे उन्होंने अपनी पोती की शक्ल में तराशा था, उस खेल के लिए जो वे कभी उसे दिखा न सके।',
      emoji: '🎭',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_26', level: 'advanced',
    title_en: "The Archivist's Cipher", title_hi: 'अभिलेखपाल की गुप्त लिपि',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'library', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h2', x: 48, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h3', x: 74, y: 42, shape: 'box', isCorrect: false },
          { id: 'h4', x: 88, y: 60, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The archivist catalogued everything, and hid one thing from her own catalogue. Watch for letters and numbers.', hi: 'अभिलेखपाल ने सब कुछ सूचीबद्ध किया, और एक चीज़ अपनी ही सूची से छिपाई। अक्षरों और नंबरों पर ध्यान देना।' },
        decoderClue: { en: 'Everything catalogued is typed. The one thing she never catalogued would be in her own handwriting.', hi: 'सूचीबद्ध सब कुछ टाइप है। जो उन्होंने कभी सूची में नहीं डाला वह उनकी अपनी लिखावट में होगा।' },
        onFoundReveal: { en: 'The handwritten index has one entry: "B-7", with no description.', hi: 'हाथ से लिखी सूची में एक ही प्रविष्टि है: "B-7", बिना किसी विवरण के।' },
      },
      {
        stageIndex: 1, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 58, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 54, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 80, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The archive stacks are down here, all lettered and numbered.', hi: 'अभिलेख का भंडार यहाँ नीचे है, सब पर अक्षर और नंबर हैं।' },
        decoderClue: { en: 'Your partner read out B-7. Row B, item 7 — and in this archive, single items always live behind a handle, never in trunks.', hi: 'तुम्हारे साथी ने B-7 बताया। पंक्ति B, चीज़ 7 — और इस भंडार में अकेली चीज़ें हमेशा हैंडल के पीछे रहती हैं, संदूकों में कभी नहीं।' },
        onFoundReveal: { en: 'Drawer B-7 holds a reel of tape and a card covered in symbols!', hi: 'दराज़ B-7 में टेप की एक रील और चिन्हों से भरा कार्ड है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 60, shape: 'drawer', isCorrect: false },
          { id: 'h2', x: 52, y: 40, shape: 'painting', isCorrect: true },
          { id: 'h3', x: 78, y: 44, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'The symbols must decode to something. She left the key somewhere personal.', hi: 'चिन्हों का कोई मतलब होगा। उन्होंने उसकी कुंजी किसी निजी जगह छोड़ी।' },
        decoderClue: { en: 'Remember the letter B your partner found. She hid her cipher key behind the only thing here whose title begins with B — and it hangs on the wall.', hi: 'याद करो वह अक्षर B जो तुम्हारे साथी को मिला। उन्होंने अपनी कुंजी यहाँ की इकलौती ऐसी चीज़ के पीछे छिपाई जिसका नाम B से शुरू होता है — और वह दीवार पर टँगी है।' },
        onFoundReveal: { en: 'Behind the painting "Blue Hour" is the cipher key — and a small key too!', hi: '"ब्लू आवर" पेंटिंग के पीछे गुप्त लिपि की कुंजी है — और एक छोटी चाबी भी!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 42, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'Decoded, the symbols name one last place.', hi: 'चिन्ह खुलने पर एक आख़िरी जगह का नाम देते हैं।' },
        decoderClue: { en: 'The decoded symbols read "B-7" again — the same code your partner found at the very start. Only one thing here is marked B-7, and it takes a key.', hi: 'चिन्हों का मतलब फिर वही निकलता है, "B-7" — वही कोड जो तुम्हारे साथी को सबसे शुरू में मिला। यहाँ सिर्फ़ एक चीज़ पर B-7 है, और उसे चाबी चाहिए।' },
        onFoundReveal: { en: 'The B-7 chest opens at last...', hi: 'B-7 वाला संदूक आख़िरकार खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is a tape recording of her grandmother’s voice, telling a story — the only recording of her that exists.',
      hi: 'अंदर उनकी दादी की आवाज़ की एक रिकॉर्डिंग है, कहानी सुनाती हुई — उनकी इकलौती मौजूद रिकॉर्डिंग।',
      emoji: '🎙️',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_27', level: 'advanced',
    title_en: "The Innkeeper's Guest Book", title_hi: 'सराय वाले की मेहमान बही',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'drawer', isCorrect: false },
          { id: 'h4', x: 88, y: 42, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'Fifty years of guests signed this inn’s book. One never signed out.', hi: 'पचास साल के मेहमानों ने इस सराय की बही में दस्तख़त किए। एक ने जाते वक़्त कभी दस्तख़त नहीं किए।' },
        decoderClue: { en: 'Accounts were printed forms; the guest book is the only thing here everyone wrote in by hand.', hi: 'हिसाब छपे फ़ॉर्म पर था; मेहमान बही ही इकलौती चीज़ है जिसमें सबने हाथ से लिखा।' },
        onFoundReveal: { en: 'The guest book shows room 4, signed in but never signed out — dated 1948.', hi: 'बही में कमरा 4 है, आने के दस्तख़त हैं पर जाने के नहीं — तारीख़ 1948।' },
      },
      {
        stageIndex: 1, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'box', isCorrect: true },
          { id: 'h2', x: 54, y: 42, shape: 'lantern', isCorrect: false },
          { id: 'h3', x: 80, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'Guests who never came back left things behind. They are stored up here.', hi: 'जो मेहमान कभी लौटे नहीं उनका सामान पीछे रह गया। वह यहाँ ऊपर रखा है।' },
        decoderClue: { en: 'Your partner found room 4 and the year 1948. Only one crate here is marked with both.', hi: 'तुम्हारे साथी को कमरा 4 और साल 1948 मिला। यहाँ सिर्फ़ एक बक्से पर दोनों लिखे हैं।' },
        onFoundReveal: { en: 'The crate holds a suitcase — locked, with a luggage tag still on it.', hi: 'बक्से में एक सूटकेस है — बंद, और उस पर आज भी सामान का टैग लगा है।' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 58, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 52, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 78, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'A locked suitcase needs a key. The innkeeper kept every key.', hi: 'बंद सूटकेस को चाबी चाहिए। सराय वाले ने हर चाबी सँभाली।' },
        decoderClue: { en: 'Room keys hung on hooks, but guests’ own keys were held for safekeeping — small things, so behind a handle, and this one is labelled 4.', hi: 'कमरों की चाबियाँ हुक पर टँगी रहती थीं, पर मेहमानों की अपनी चाबियाँ सँभालकर रखी जाती थीं — छोटी चीज़ें, तो हैंडल के पीछे, और इस पर 4 लिखा है।' },
        onFoundReveal: { en: 'Drawer 4 holds a small key on a paper tag!', hi: 'दराज़ 4 में कागज़ के टैग वाली एक छोटी चाबी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 42, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'Go back to the suitcase and open it.', hi: 'सूटकेस के पास लौटो और उसे खोलो।' },
        decoderClue: { en: 'The number 4 has run through everything — the room, the crate, the drawer. Open the one thing with a lid and a lock, not the plain crate you already searched.', hi: 'नंबर 4 हर जगह चला आया है — कमरा, बक्सा, दराज़। ढक्कन और ताले वाली चीज़ खोलो, वह सादा बक्सा नहीं जिसे तुम पहले देख चुके हो।' },
        onFoundReveal: { en: 'The old suitcase opens after seventy-five years...', hi: 'पचहत्तर साल बाद पुराना सूटकेस खुलता है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside are letters the guest wrote but never posted, addressed to a family who spent decades wondering what became of him.',
      hi: 'अंदर वे चिट्ठियाँ हैं जो मेहमान ने लिखीं पर कभी भेजी नहीं, उस परिवार के नाम जो दशकों तक सोचता रहा कि उनका क्या हुआ।',
      emoji: '📔',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_28', level: 'advanced',
    title_en: "The Fisherman's Knot", title_hi: 'मछुआरे की गाँठ',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 42, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 48, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 74, y: 42, shape: 'jar', isCorrect: false },
          { id: 'h4', x: 88, y: 62, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The fisherman mended nets here for sixty years. Notice what he counted.', hi: 'मछुआरा यहाँ साठ साल जाल सुधारता रहा। ध्यान दो कि वे क्या गिनते थे।' },
        decoderClue: { en: 'Every net he owned is listed with the number of knots in it. One net has a count but no name.', hi: 'उनके हर जाल के आगे उसकी गाँठों की गिनती लिखी है। एक जाल में गिनती है पर नाम नहीं।' },
        onFoundReveal: { en: 'The net book lists one net with 108 knots and no name beside it.', hi: 'जाल की किताब में एक जाल है जिसमें 108 गाँठें हैं और आगे कोई नाम नहीं।' },
      },
      {
        stageIndex: 1, sceneTheme: 'garden-shed', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'box', isCorrect: true },
          { id: 'h2', x: 54, y: 42, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 80, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The nets themselves are stored out here.', hi: 'जाल खुद यहीं बाहर रखे हैं।' },
        decoderClue: { en: 'Your partner found the count: 108 knots. Only one crate out here has 108 painted on the side.', hi: 'तुम्हारे साथी को गिनती मिली: 108 गाँठें। यहाँ सिर्फ़ एक बक्से के किनारे 108 लिखा है।' },
        onFoundReveal: { en: 'Crate 108 holds a net — hand-tied, and far too small to fish with.', hi: 'बक्सा 108 में एक जाल है — हाथ से बुना, और मछली पकड़ने के लिए बहुत छोटा।' },
      },
      {
        stageIndex: 2, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 40, shape: 'painting', isCorrect: true },
          { id: 'h2', x: 52, y: 62, shape: 'drawer', isCorrect: false },
          { id: 'h3', x: 78, y: 44, shape: 'notebook', isCorrect: false },
        ],
        searcherPrompt: { en: 'A net too small to fish with was made for someone small.', hi: 'मछली पकड़ने के लिए बहुत छोटा जाल किसी छोटे के लिए बना था।' },
        decoderClue: { en: 'The little net is a child’s size. He hung the reason on the wall — the only thing here with two people in it.', hi: 'नन्हा जाल बच्चे के नाप का है। उसकी वजह उन्होंने दीवार पर टाँगी — यहाँ इकलौती चीज़ जिसमें दो लोग हैं।' },
        onFoundReveal: { en: 'The painting shows him teaching a boy to tie a knot — a key hangs behind it!', hi: 'पेंटिंग में वे एक लड़के को गाँठ बाँधना सिखा रहे हैं — उसके पीछे एक चाबी टँगी है!' },
      },
      {
        stageIndex: 3, sceneTheme: 'cellar', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 44, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'jar', isCorrect: false },
          { id: 'h3', x: 80, y: 58, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The key opens the last thing he locked away.', hi: 'चाबी उस आख़िरी चीज़ को खोलती है जिसे उन्होंने बंद किया।' },
        decoderClue: { en: 'Remember the number that has followed you: 108. The locked thing carries it, and rope must stay dry — so a lid, never an open crate.', hi: 'याद करो वह नंबर जो साथ चला आया है: 108. बंद चीज़ पर वही है, और रस्सी सूखी रहनी चाहिए — तो ढक्कन, खुला बक्सा कभी नहीं।' },
        onFoundReveal: { en: 'Chest 108 opens, smelling of salt and rope...', hi: 'संदूक 108 खुलता है, नमक और रस्सी की महक के साथ...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is the first net his own father taught him to tie, kept for the grandson he was teaching when the painting was made.',
      hi: 'अंदर वह पहला जाल है जो उनके पिता ने उन्हें बुनना सिखाया था, उस पोते के लिए सँभाला हुआ जिसे वे पेंटिंग वाले दिनों में सिखा रहे थे।',
      emoji: '🪢',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_29', level: 'advanced',
    title_en: "The Glassblower's Colour", title_hi: 'काँच बनाने वाले का रंग',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'workshop', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 44, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 48, y: 62, shape: 'box', isCorrect: false },
          { id: 'h3', x: 74, y: 44, shape: 'notebook', isCorrect: false },
          { id: 'h4', x: 88, y: 62, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'The furnace is cold. He made one colour nobody could copy. Remember its name.', hi: 'भट्ठी ठंडी है। उन्होंने एक ऐसा रंग बनाया जिसकी नकल कोई न कर सका। उसका नाम याद रखना।' },
        decoderClue: { en: 'Ordinary glass was stacked openly. The colour he guarded was kept where he could see it but nobody could reach it — sealed behind glass itself.', hi: 'साधारण काँच खुले में रखा था। जिस रंग की वे रखवाली करते थे वह वहाँ था जहाँ दिखे पर कोई पहुँच न सके — काँच के ही पीछे सील।' },
        onFoundReveal: { en: 'The sealed jar holds a shard of deep green glass, labelled "Marisa".', hi: 'सील मर्तबान में गहरे हरे काँच का टुकड़ा है, जिस पर लिखा है "मरीसा"।' },
      },
      {
        stageIndex: 1, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 58, shape: 'notebook', isCorrect: true },
          { id: 'h2', x: 54, y: 40, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 80, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'A colour that good has a formula. He would have written it down.', hi: 'इतना अच्छा रंग बिना नुस्खे के नहीं बनता। उन्होंने ज़रूर लिखा होगा।' },
        decoderClue: { en: 'Your partner found the colour is called Marisa. He indexed his formulas by name, and his own formulas were always handwritten.', hi: 'तुम्हारे साथी को मिला कि रंग का नाम मरीसा है। वे अपने नुस्खे नाम से रखते थे, और अपने नुस्खे हमेशा हाथ से लिखते थे।' },
        onFoundReveal: { en: 'The formula book has a page for Marisa — but the last ingredient is torn out!', hi: 'नुस्खों की किताब में मरीसा का पन्ना है — पर आख़िरी सामग्री फाड़ दी गई है!' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 58, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 52, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 78, y: 60, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'He tore out the ingredient so nobody could copy it. But he kept it.', hi: 'उन्होंने वह सामग्री फाड़ दी ताकि कोई नकल न कर सके। पर उसे सँभाला ज़रूर।' },
        decoderClue: { en: 'A single torn page is small, and small things live behind a handle here — look for the one labelled with the same name your partner read: Marisa.', hi: 'फटा हुआ अकेला पन्ना छोटा है, और छोटी चीज़ें यहाँ हैंडल के पीछे रहती हैं — वही नाम ढूँढो जो तुम्हारे साथी ने पढ़ा: मरीसा।' },
        onFoundReveal: { en: 'The Marisa drawer holds the torn page — and a key!', hi: 'मरीसा वाले दराज़ में फटा पन्ना है — और एक चाबी!' },
      },
      {
        stageIndex: 3, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 42, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 60, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 44, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The key opens the only thing he ever made in that colour.', hi: 'चाबी उस इकलौती चीज़ को खोलती है जो उन्होंने उस रंग में बनाई।' },
        decoderClue: { en: 'Glass breaks, so it needs padding and a lid — and remember the name on the shard: the locked thing carries "Marisa" too.', hi: 'काँच टूटता है, तो गद्दी और ढक्कन चाहिए — और याद करो टुकड़े पर लिखा नाम: बंद चीज़ पर भी "मरीसा" है।' },
        onFoundReveal: { en: 'The padded chest opens, and green light spills out...', hi: 'गद्दीदार संदूक खुलता है, और हरी रोशनी बिखर जाती है...' },
      },
    ],
    treasureReveal: {
      en: 'Inside is a glass bird in that impossible green — made for his wife Marisa, whose eyes were exactly that colour.',
      hi: 'अंदर उसी असंभव हरे रंग की एक काँच की चिड़िया है — उनकी पत्नी मरीसा के लिए बनाई, जिनकी आँखें ठीक उसी रंग की थीं।',
      emoji: '🕊️',
    },
    facilitatorQuestions: FQ,
  },
  {
    id: 'adv_30', level: 'advanced',
    title_en: "The Last Envelope", title_hi: 'आख़िरी लिफ़ाफ़ा',
    stages: [
      {
        stageIndex: 0, sceneTheme: 'study', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 22, y: 58, shape: 'drawer', isCorrect: true },
          { id: 'h2', x: 48, y: 38, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 74, y: 60, shape: 'notebook', isCorrect: false },
          { id: 'h4', x: 88, y: 40, shape: 'lantern', isCorrect: false },
        ],
        searcherPrompt: { en: 'She wrote a letter every week of her life. Remember the details — this quest folds back on itself.', hi: 'उन्होंने ज़िंदगी के हर हफ़्ते एक चिट्ठी लिखी। बातें याद रखना — यह खोज खुद पर लौटती है।' },
        decoderClue: { en: 'Finished letters were posted; the unfinished one never left her desk, and letters live behind a handle, not on a shelf.', hi: 'पूरी चिट्ठियाँ भेज दी जाती थीं; अधूरी कभी मेज़ से नहीं हटी, और चिट्ठियाँ हैंडल के पीछे रहती हैं, शेल्फ़ पर नहीं।' },
        onFoundReveal: { en: 'The drawer holds one sealed envelope, addressed but never stamped. The address is a room: "the attic, third beam".', hi: 'दराज़ में एक सील लिफ़ाफ़ा है, पता लिखा पर टिकट नहीं। पता एक जगह है: "अटारी, तीसरा शहतीर"।' },
      },
      {
        stageIndex: 1, sceneTheme: 'attic', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 42, shape: 'lantern', isCorrect: true },
          { id: 'h2', x: 54, y: 62, shape: 'box', isCorrect: false },
          { id: 'h3', x: 80, y: 44, shape: 'jar', isCorrect: false },
        ],
        searcherPrompt: { en: 'The envelope is addressed to a place, not a person.', hi: 'लिफ़ाफ़े पर किसी जगह का पता है, किसी इंसान का नहीं।' },
        decoderClue: { en: 'Your partner read "the third beam". Look at what hangs from the beams — only one thing up here hangs at all.', hi: 'तुम्हारे साथी ने पढ़ा "तीसरा शहतीर"। देखो शहतीरों से क्या लटका है — यहाँ सिर्फ़ एक ही चीज़ लटकी है।' },
        onFoundReveal: { en: 'Inside the hanging lantern is a second envelope, addressed to "the cellar, behind the year".', hi: 'लटकी लालटेन के अंदर दूसरा लिफ़ाफ़ा है, पता: "तहख़ाना, साल के पीछे"।' },
      },
      {
        stageIndex: 2, sceneTheme: 'cellar', searcherRole: 'client',
        hotspots: [
          { id: 'h1', x: 26, y: 58, shape: 'jar', isCorrect: true },
          { id: 'h2', x: 52, y: 44, shape: 'chest', isCorrect: false },
          { id: 'h3', x: 78, y: 60, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: '"Behind the year." Something down here is marked with one.', hi: '"साल के पीछे।" यहाँ नीचे किसी चीज़ पर साल लिखा है।' },
        decoderClue: { en: 'The first envelope your partner found was dated 1979. Down here, only what she preserved carries a year — and preserved things are kept in glass.', hi: 'तुम्हारे साथी को मिले पहले लिफ़ाफ़े पर 1979 था। यहाँ नीचे सिर्फ़ सुरक्षित रखी चीज़ों पर साल होता है — और वे काँच में रखी जाती हैं।' },
        onFoundReveal: { en: 'The 1979 jar holds a third envelope and a small key: "the study, where it started".', hi: '1979 वाले मर्तबान में तीसरा लिफ़ाफ़ा और एक छोटी चाबी है: "अध्ययन कक्ष, जहाँ से शुरू हुआ"।' },
      },
      {
        stageIndex: 3, sceneTheme: 'study', searcherRole: 'therapist',
        hotspots: [
          { id: 'h1', x: 28, y: 60, shape: 'chest', isCorrect: true },
          { id: 'h2', x: 54, y: 38, shape: 'painting', isCorrect: false },
          { id: 'h3', x: 80, y: 58, shape: 'drawer', isCorrect: false },
        ],
        searcherPrompt: { en: 'The trail has come back to where it began.', hi: 'रास्ता वहीं लौट आया है जहाँ से शुरू हुआ था।' },
        decoderClue: { en: 'The very first envelope was found behind a handle — so this time it is not the drawer. It is the locked thing marked 1979, the year your partner just read out.', hi: 'सबसे पहला लिफ़ाफ़ा हैंडल के पीछे मिला था — तो इस बार दराज़ नहीं। यह 1979 वाली बंद चीज़ है, वही साल जो तुम्हारे साथी ने अभी पढ़ा।' },
        onFoundReveal: { en: 'The 1979 chest opens where the whole quest began...', hi: '1979 वाला संदूक वहीं खुलता है जहाँ से पूरी खोज शुरू हुई थी...' },
      },
    ],
    treasureReveal: {
      en: 'Inside are all fifty-two letters she wrote to her daughter and never sent — one for every week of the year they did not speak.',
      hi: 'अंदर वे बावन चिट्ठियाँ हैं जो उन्होंने अपनी बेटी को लिखीं और कभी भेजीं नहीं — उस साल के हर हफ़्ते की एक, जब उन दोनों में बात नहीं हुई।',
      emoji: '✉️',
    },
    facilitatorQuestions: FQ,
  },
]

const LEVEL_ORDER: Level[] = ['easy', 'moderate', 'advanced']

const LEVEL_BADGE: Record<Level, { bg: string; color: string }> = {
  easy: { bg: '#e8f5ee', color: '#1a6e40' },
  moderate: { bg: '#fef9e7', color: '#8a6010' },
  advanced: { bg: '#faeee7', color: '#8a3010' },
}

const NUNITO = "'Nunito', sans-serif"
const DEVANAGARI = "'Noto Sans Devanagari', 'Nunito', sans-serif"
const GOLD = ['#e8b84b', '#f3d27a', '#c9963f', '#ffdca8', '#d8a75a']

const scenariosFor = (level: Level) => SCENARIOS.filter((s) => s.level === level)

// Hotspot ids repeat across stages ('h1', 'h2'...), so the synced arrays store a
// fully-qualified key. Without this, finding 'h2' in stage 0 would instantly mark
// stage 1's 'h2' as already revealed.
const hotspotKey = (scenarioId: string, stageIndex: number, hotspotId: string) =>
  `${scenarioId}:${stageIndex}:${hotspotId}`

/* ===== Scene palettes — every room is warm and lantern-lit, never dark or cold ===== */
const SCENE: Record<SceneTheme, { base: string; glow: string[]; silhouette: string }> = {
  study: {
    base: 'linear-gradient(180deg, #3d2b1f 0%, #5a4231 40%, #4a3626 100%)',
    glow: ['18% 30%', '68% 55%'],
    silhouette: '#2b1d14',
  },
  attic: {
    base: 'linear-gradient(180deg, #4a3524 0%, #6b5138 42%, #55402c 100%)',
    glow: ['30% 25%', '75% 60%'],
    silhouette: '#33251a',
  },
  cellar: {
    base: 'linear-gradient(180deg, #3b3733 0%, #57504a 42%, #47413a 100%)',
    glow: ['22% 35%', '70% 58%'],
    silhouette: '#2a2622',
  },
  library: {
    base: 'linear-gradient(180deg, #3a2422 0%, #5c3a33 42%, #4a2f29 100%)',
    glow: ['20% 28%', '72% 52%'],
    silhouette: '#291817',
  },
  'garden-shed': {
    base: 'linear-gradient(180deg, #4f4230 0%, #7a6a4a 45%, #5f5238 100%)',
    glow: ['78% 22%', '30% 60%'],
    silhouette: '#3a3122',
  },
  workshop: {
    base: 'linear-gradient(180deg, #43301f 0%, #66492f 42%, #513a26 100%)',
    glow: ['25% 30%', '72% 58%'],
    silhouette: '#31220f',
  },
}

function Silhouettes({ theme }: { theme: SceneTheme }) {
  const c = SCENE[theme].silhouette
  const S = (style: React.CSSProperties, key: number) => <div key={key} style={{ position: 'absolute', background: c, opacity: 0.3, ...style }} />

  if (theme === 'study' || theme === 'library') {
    return (
      <>
        {[0, 1, 2].map((i) => S({ left: `${4 + i * 9}%`, bottom: '22%', width: '7%', height: '46%', borderRadius: 3 }, i))}
        {S({ left: '4%', bottom: '44%', width: '25%', height: 4 }, 3)}
        {S({ right: '6%', bottom: '20%', width: '26%', height: '18%', borderRadius: '6px 6px 0 0' }, 4)}
        {S({ left: '32%', bottom: '8%', width: '40%', height: '9%', borderRadius: '50%', opacity: 0.25 } as React.CSSProperties, 5)}
      </>
    )
  }
  if (theme === 'attic') {
    return (
      <>
        {S({ top: '4%', left: '-6%', width: '62%', height: 8, transform: 'rotate(14deg)', transformOrigin: 'left center' }, 0)}
        {S({ top: '4%', right: '-6%', width: '62%', height: 8, transform: 'rotate(-14deg)', transformOrigin: 'right center' }, 1)}
        {S({ top: '26%', left: '18%', right: '18%', height: 6 }, 2)}
        {S({ left: '6%', bottom: '20%', width: '16%', height: '22%', borderRadius: 4 }, 3)}
        {S({ right: '8%', bottom: '20%', width: '12%', height: '16%', borderRadius: 4 }, 4)}
      </>
    )
  }
  if (theme === 'cellar') {
    return (
      <>
        {[0, 1].map((i) => S({ left: `${8 + i * 62}%`, top: '10%', width: '30%', height: '34%', borderRadius: '50% 50% 0 0', opacity: 0.22 } as React.CSSProperties, i))}
        {S({ left: '6%', bottom: '20%', width: '13%', height: '20%', borderRadius: '40% 40% 8px 8px' }, 2)}
        {S({ right: '10%', bottom: '20%', width: '13%', height: '20%', borderRadius: '40% 40% 8px 8px' }, 3)}
      </>
    )
  }
  if (theme === 'garden-shed') {
    return (
      <>
        {S({ right: '8%', top: '10%', width: '20%', height: '24%', borderRadius: 4, background: 'rgba(255,235,180,0.28)', opacity: 1 } as React.CSSProperties, 0)}
        {S({ left: '5%', bottom: '26%', width: '30%', height: 5 }, 1)}
        {S({ left: '5%', bottom: '42%', width: '24%', height: 5 }, 2)}
        {S({ left: '38%', bottom: '20%', width: '10%', height: '26%', borderRadius: '50% 50% 2px 2px' }, 3)}
      </>
    )
  }
  return (
    <>
      {S({ left: '5%', bottom: '30%', width: '34%', height: 5 }, 0)}
      {[0, 1, 2, 3].map((i) => S({ left: `${8 + i * 8}%`, bottom: '32%', width: 4, height: '13%', borderRadius: 2 }, i + 1))}
      {S({ right: '7%', bottom: '20%', width: '24%', height: '20%', borderRadius: 3 }, 5)}
    </>
  )
}

function DustMotes() {
  return (
    <>
      {[
        { l: '12%', t: '70%', d: '0s', s: 3 }, { l: '28%', t: '80%', d: '-3s', s: 2 },
        { l: '44%', t: '66%', d: '-6s', s: 3 }, { l: '58%', t: '84%', d: '-1.5s', s: 2 },
        { l: '71%', t: '72%', d: '-4.5s', s: 3 }, { l: '84%', t: '78%', d: '-7s', s: 2 },
        { l: '36%', t: '88%', d: '-2s', s: 2 }, { l: '66%', t: '90%', d: '-5s', s: 3 },
      ].map((m, i) => (
        <div
          key={i}
          style={{
            position: 'absolute', left: m.l, top: m.t, width: m.s, height: m.s, borderRadius: '50%',
            background: '#f3d27a', opacity: 0.3, animation: `tqMote 14s linear ${m.d} infinite`,
          }}
        />
      ))}
    </>
  )
}

/* ===== Hotspot object art — CSS/SVG only ===== */
function ShapeArt({ shape }: { shape: Shape }) {
  const sh = 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))'
  switch (shape) {
    case 'notebook':
      return (
        <div style={{ width: 34, height: 42, borderRadius: 3, background: 'linear-gradient(160deg,#e8d5ab,#c9ab7c)', transform: 'rotate(-4deg)', filter: sh, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 5, width: 2, background: '#6b4a2a', opacity: 0.7 }} />
        </div>
      )
    case 'painting':
      return (
        <div style={{ width: 52, height: 40, padding: 3, borderRadius: 2, background: 'linear-gradient(140deg,#e8b84b,#a87c2e)', filter: sh }}>
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(160deg,#6b7f6a,#8a7f5a)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', width: 18, height: 18, borderRadius: '50%', background: 'rgba(243,210,122,0.65)', top: 4, left: 5 }} />
            <div style={{ position: 'absolute', width: 26, height: 12, borderRadius: '50% 50% 0 0', background: 'rgba(90,110,80,0.8)', bottom: 0, right: 2 }} />
          </div>
        </div>
      )
    case 'lantern':
      return (
        <div style={{ position: 'relative', width: 30, height: 42, filter: sh }}>
          <svg width={30} height={42} viewBox="0 0 30 42">
            <rect x={12} y={0} width={6} height={5} rx={2} fill="#8a6a3a" />
            <rect x={4} y={5} width={22} height={4} rx={2} fill="#6b4f2a" />
            <rect x={6} y={9} width={18} height={24} rx={3} fill="#7d5c33" />
            <rect x={9} y={12} width={12} height={18} rx={2} fill="#ffd68a" />
            <rect x={4} y={33} width={22} height={5} rx={2} fill="#6b4f2a" />
          </svg>
          <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,200,120,0.5) 0%, transparent 70%)', animation: 'tqFlicker 3.4s ease-in-out infinite', pointerEvents: 'none' }} />
        </div>
      )
    case 'box':
      return (
        <div style={{ width: 44, height: 34, borderRadius: 3, background: 'linear-gradient(170deg,#a87a4a,#6f4d2c)', filter: sh, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 10, left: 0, right: 0, height: 1.5, background: 'rgba(0,0,0,0.3)' }} />
          <div style={{ position: 'absolute', top: 22, left: 0, right: 0, height: 1.5, background: 'rgba(0,0,0,0.3)' }} />
        </div>
      )
    case 'jar':
      return (
        <div style={{ position: 'relative', width: 28, height: 40, filter: sh }}>
          <svg width={28} height={40} viewBox="0 0 28 40">
            <rect x={9} y={0} width={10} height={5} rx={2} fill="#8a6a3a" />
            <path d="M5 8 Q5 5 9 5 L19 5 Q23 5 23 8 L23 34 Q23 38 19 38 L9 38 Q5 38 5 34 Z" fill="rgba(232,184,75,0.45)" stroke="rgba(255,240,200,0.5)" strokeWidth={1} />
            <rect x={8} y={11} width={2.5} height={18} rx={1.2} fill="rgba(255,255,255,0.5)" />
          </svg>
        </div>
      )
    case 'drawer':
      return (
        <div style={{ width: 46, height: 28, borderRadius: 3, background: 'linear-gradient(180deg,#9b7147,#6b4a2a)', filter: sh, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 14, height: 4, borderRadius: 2, background: 'linear-gradient(180deg,#e8d09a,#a8863f)' }} />
        </div>
      )
    case 'chest':
      return (
        <div style={{ position: 'relative', width: 52, height: 40, filter: sh }}>
          <div style={{ position: 'absolute', bottom: 0, width: 52, height: 24, borderRadius: '2px 2px 3px 3px', background: 'linear-gradient(180deg,#9b7147,#5f4128)' }} />
          <div style={{ position: 'absolute', top: 0, width: 52, height: 20, borderRadius: '24px 24px 0 0', background: 'linear-gradient(180deg,#a87a4a,#7d5731)' }} />
          <div style={{ position: 'absolute', top: 16, left: 0, width: 6, height: 24, background: '#c9963f', opacity: 0.85 }} />
          <div style={{ position: 'absolute', top: 16, right: 0, width: 6, height: 24, background: '#c9963f', opacity: 0.85 }} />
          <div style={{ position: 'absolute', top: 15, left: '50%', transform: 'translateX(-50%)', fontSize: 14, color: '#ffe9b0' }}>★</div>
        </div>
      )
    case 'key':
      return (
        <svg width={40} height={18} viewBox="0 0 40 18" style={{ filter: sh }}>
          <circle cx={7} cy={9} r={6} fill="none" stroke="#d8a75a" strokeWidth={3} />
          <rect x={12} y={7.5} width={24} height={3} rx={1.5} fill="#d8a75a" />
          <rect x={30} y={10} width={3} height={5} rx={1} fill="#d8a75a" />
          <rect x={35} y={10} width={3} height={5} rx={1} fill="#d8a75a" />
        </svg>
      )
    case 'map':
      return (
        <div style={{ position: 'relative', width: 46, height: 30, filter: sh }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 3, background: 'linear-gradient(160deg,#f0e0b8,#cdb383)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '33%', width: 1, background: 'rgba(120,90,50,0.4)' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: '66%', width: 1, background: 'rgba(120,90,50,0.4)' }} />
          <div style={{ position: 'absolute', top: -3, left: '46%', width: 9, height: 9, borderRadius: '50%', background: '#c0704a', border: '1px solid #f0e0b8' }} />
        </div>
      )
    case 'locker':
      return (
        <div style={{ width: 36, height: 48, borderRadius: 3, background: 'linear-gradient(170deg,#8d8578,#5f594e)', filter: sh, position: 'relative' }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ position: 'absolute', top: 6 + i * 5, left: 6, right: 6, height: 2, borderRadius: 1, background: 'rgba(0,0,0,0.32)' }} />
          ))}
          <div style={{ position: 'absolute', top: '52%', right: 5, width: 4, height: 10, borderRadius: 2, background: '#d8a75a' }} />
        </div>
      )
  }
}

export default function TreasureQuest({ sessionId, role, isLocked }: TreasureQuestProps) {
  const isT = role === 'therapist'

  const [scenarioId, setScenarioId] = useState('easy_1')
  const [level, setLevel] = useState<Level>('easy')
  const [stage, setStage] = useState(0)
  const [revealed, setRevealed] = useState<string[]>([])
  const [language, setLanguage] = useState<Lang>('both')
  const [completed, setCompleted] = useState(false)
  const [shakeId, setShakeId] = useState<string | null>(null)
  const [missMsg, setMissMsg] = useState(false)
  const [fqOpen, setFqOpen] = useState(false)

  const advanceT = useRef<ReturnType<typeof setTimeout>>()
  const shakeT = useRef<ReturnType<typeof setTimeout>>()

  const write = useCallback(async (d: Record<string, unknown>) => {
    try { await updateDoc(doc(db, 'liveSessions', sessionId), { ...d, 'timestamps.updatedAt': new Date().toISOString() }) } catch {}
  }, [sessionId])

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const s = snap.data().moduleState || {}
      if (typeof s.tqCurrentScenarioId === 'string') setScenarioId(s.tqCurrentScenarioId)
      if (s.tqLevel === 'easy' || s.tqLevel === 'moderate' || s.tqLevel === 'advanced') setLevel(s.tqLevel)
      if (typeof s.tqCurrentStage === 'number') setStage(s.tqCurrentStage)
      if (Array.isArray(s.tqRevealedHotspots)) setRevealed(s.tqRevealedHotspots as string[])
      if (s.tqLanguage === 'en' || s.tqLanguage === 'hi' || s.tqLanguage === 'both') setLanguage(s.tqLanguage)
      if (typeof s.tqCompleted === 'boolean') setCompleted(s.tqCompleted)
    })
    return () => unsub()
  }, [sessionId])

  useEffect(() => () => {
    if (advanceT.current) clearTimeout(advanceT.current)
    if (shakeT.current) clearTimeout(shakeT.current)
  }, [])

  const levelScenarios = useMemo(() => scenariosFor(level), [level])
  const scenario = useMemo(
    () => levelScenarios.find((s) => s.id === scenarioId) ?? levelScenarios[0],
    [levelScenarios, scenarioId]
  )
  const stageIdx = Math.min(stage, scenario.stages.length - 1)
  const stageData = scenario.stages[stageIdx]

  // The stage's own `searcherRole` is authoritative — tqSearcherRole is kept in
  // sync on every transition, but deriving from the data can never drift.
  const isSearcher = role === stageData.searcherRole
  const canClick = isSearcher && (isT || !isLocked) && !completed

  const showEn = language === 'en' || language === 'both'
  const showHi = language === 'hi' || language === 'both'

  const foundHere = stageData.hotspots.some(
    (h) => h.isCorrect && revealed.includes(hotspotKey(scenario.id, stageData.stageIndex, h.id))
  )

  const handleHotspot = useCallback((h: Hotspot) => {
    if (!canClick || foundHere) return
    if (!h.isCorrect) {
      setShakeId(h.id)
      setMissMsg(true)
      if (shakeT.current) clearTimeout(shakeT.current)
      shakeT.current = setTimeout(() => { setShakeId(null); setMissMsg(false) }, 1600)
      return
    }
    const k = hotspotKey(scenario.id, stageData.stageIndex, h.id)
    write({
      'moduleState.tqFoundClues': arrayUnion(k),
      'moduleState.tqRevealedHotspots': arrayUnion(k),
    })
    // Only the clicking client schedules the advance — if both ran this timer the
    // stage would increment twice.
    if (advanceT.current) clearTimeout(advanceT.current)
    advanceT.current = setTimeout(() => {
      if (stageData.stageIndex >= scenario.stages.length - 1) {
        write({ 'moduleState.tqCompleted': true })
        logModuleEvent(sessionId, {
          module: 'treasure-quest',
          type: 'quest_completed',
          detail: `${scenario.id} (${level}) "${scenario.title_en}" completed — found ${scenario.treasureReveal.en}`,
        })
      } else {
        write({
          'moduleState.tqCurrentStage': increment(1),
          'moduleState.tqSearcherRole': stageData.searcherRole === 'therapist' ? 'client' : 'therapist',
        })
      }
    }, 2000)
  }, [canClick, foundHere, scenario, stageData, write, sessionId, level])

  const loadScenario = useCallback((id: string, lvl: Level) => {
    const sc = SCENARIOS.find((s) => s.id === id)
    write({
      'moduleState.tqCurrentScenarioId': id,
      'moduleState.tqLevel': lvl,
      'moduleState.tqCurrentStage': 0,
      'moduleState.tqFoundClues': [],
      'moduleState.tqRevealedHotspots': [],
      'moduleState.tqCompleted': false,
      'moduleState.tqSearcherRole': sc?.stages[0].searcherRole ?? 'client',
    })
    setFqOpen(false)
  }, [write])

  const handleNextQuest = useCallback(() => {
    if (!isT) return
    const i = levelScenarios.findIndex((s) => s.id === scenario.id)
    if (i < levelScenarios.length - 1) { loadScenario(levelScenarios[i + 1].id, level); return }
    const nl = LEVEL_ORDER[LEVEL_ORDER.indexOf(level) + 1]
    if (nl) loadScenario(scenariosFor(nl)[0].id, nl)
    else loadScenario('easy_1', 'easy')
  }, [isT, levelScenarios, scenario.id, level, loadScenario])

  const questIdx = levelScenarios.findIndex((s) => s.id === scenario.id)
  const badge = LEVEL_BADGE[level]
  const parchment: React.CSSProperties = {
    background: 'linear-gradient(160deg, rgba(250,240,220,0.97), rgba(236,220,190,0.97))',
    borderRadius: 14, border: '2px solid rgba(120,80,40,0.28)',
    boxShadow: '0 8px 22px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -8px 18px rgba(160,120,70,0.14)',
    padding: '10px 12px', fontFamily: NUNITO,
  }

  return (
    <>
      <style>{`
        @keyframes tqFlicker { 0%,100% { opacity: 0.7; } 50% { opacity: 1; } }
        @keyframes tqMote { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: 0.4; } 80% { opacity: 0.3; } 100% { transform: translateY(-120px); opacity: 0; } }
        @keyframes tqPulse { 0%,100% { opacity: 0.1; transform: scale(1); } 50% { opacity: 0.2; transform: scale(1.12); } }
        @keyframes tqShake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
        @keyframes tqSpark { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--tqx), var(--tqy)) scale(0.4); opacity: 0; } }
        @keyframes tqFall { 0% { transform: translateY(-40px) translateX(0) rotate(0deg); opacity: 0; } 12% { opacity: 1; } 100% { transform: translateY(420px) translateX(var(--tqsway)) rotate(220deg); opacity: 0; } }
      `}</style>

      <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 420, overflow: 'hidden', borderRadius: 16, fontFamily: NUNITO }}>
        <AnimatePresence mode="wait">
          {completed ? (
            /* ===== Treasure reveal ===== */
            <motion.div
              key="treasure"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.4 }}
              style={{
                position: 'absolute', inset: 0,
                background: 'radial-gradient(ellipse at 50% 45%, #a87434 0%, #7a5327 45%, #513a26 100%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24,
              }}
            >
              {/* gold shower */}
              {Array.from({ length: 22 }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    position: 'absolute', top: 0, left: `${(i * 4.3 + 4) % 96}%`, width: 6, height: 6, borderRadius: '50%',
                    background: GOLD[i % GOLD.length],
                    '--tqsway': `${(i % 2 ? 1 : -1) * (10 + (i % 5) * 6)}px`,
                    animation: `tqFall ${2600 + (i % 6) * 260}ms linear ${(i % 8) * 0.22}s infinite`,
                    pointerEvents: 'none',
                  } as React.CSSProperties}
                />
              ))}

              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 16, delay: 0.15 }}
                style={{ fontSize: 70, lineHeight: 1, zIndex: 2 }}
              >
                {scenario.treasureReveal.emoji}
              </motion.div>
              <div style={{ fontSize: 21, fontWeight: 900, color: '#fff6e2', zIndex: 2 }}>
                {showEn && 'You found it!'}
                {language === 'both' && ' · '}
                {showHi && <span style={{ fontFamily: DEVANAGARI }}>तुमने पा लिया!</span>}
              </div>
              <div style={{ maxWidth: 460, textAlign: 'center', zIndex: 2 }}>
                {showEn && <div style={{ fontSize: 17.5, fontWeight: 700, color: '#fdf0d8', lineHeight: 1.5 }}>{scenario.treasureReveal.en}</div>}
                {showHi && <div style={{ fontSize: 17.5, fontWeight: 600, fontFamily: DEVANAGARI, color: 'rgba(253,240,216,0.8)', lineHeight: 1.6, marginTop: 4 }}>{scenario.treasureReveal.hi}</div>}
              </div>

              {isT && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 220, marginTop: 10, zIndex: 2 }}>
                  <button
                    onClick={handleNextQuest}
                    style={{ width: '100%', padding: '8px 0', borderRadius: 50, cursor: 'pointer', fontSize: 16, fontWeight: 800, fontFamily: NUNITO, background: 'rgba(74,124,111,0.9)', border: 'none', color: '#fff' }}
                  >
                    Next quest →
                  </button>
                  <button
                    onClick={() => setFqOpen((o) => !o)}
                    style={{ width: '100%', padding: '7px 0', borderRadius: 50, cursor: 'pointer', fontSize: 14, fontWeight: 800, fontFamily: NUNITO, background: 'rgba(107,92,231,0.85)', border: 'none', color: '#fff' }}
                  >
                    💬 Talk about it
                  </button>
                  <button
                    onClick={() => {
                      loadScenario('easy_1', 'easy')
                      logModuleEvent(sessionId, { module: 'treasure-quest', type: 'module_ended', detail: `Therapist ended the module after "${scenario.title_en}".` })
                    }}
                    style={{ width: '100%', padding: '7px 0', borderRadius: 50, cursor: 'pointer', fontSize: 14, fontWeight: 700, fontFamily: NUNITO, background: 'transparent', border: '1px solid rgba(255,246,226,0.3)', color: 'rgba(255,246,226,0.6)' }}
                  >
                    End module
                  </button>
                </div>
              )}

              {isT && fqOpen && (
                <div style={{ zIndex: 2, marginTop: 6, width: 'min(90%, 420px)', background: 'rgba(107,92,231,0.9)', border: '1px solid rgba(107,92,231,0.5)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 6 }}>💬 Ask the child</div>
                  <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {scenario.facilitatorQuestions.map((q, i) => (
                      <li key={i} style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)', lineHeight: 1.35 }}>
                        <span style={{ display: 'block' }}>{q.en}</span>
                        <span style={{ display: 'block', fontFamily: DEVANAGARI, color: 'rgba(255,255,255,0.7)' }}>{q.hi}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </motion.div>
          ) : (
            /* ===== Scene ===== */
            <motion.div
              key={`${scenario.id}-${stageIdx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45 }}
              style={{ position: 'absolute', inset: 0 }}
            >
              {/* Layer 1 — room base */}
              <div style={{ position: 'absolute', inset: 0, background: SCENE[stageData.sceneTheme].base }} />

              {/* Layer 2 — lantern glow pools */}
              {SCENE[stageData.sceneTheme].glow.map((pos, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    background: `radial-gradient(circle at ${pos}, rgba(255,200,120,0.15) 0%, transparent 45%)`,
                    animation: `tqFlicker ${3 + i * 0.7}s ease-in-out ${i * 0.5}s infinite`,
                  }}
                />
              ))}

              {/* Layer 3 — silhouettes */}
              <Silhouettes theme={stageData.sceneTheme} />

              {/* Layer 4 — dust motes */}
              <DustMotes />

              {/* Layer 5 — hotspots */}
              {stageData.hotspots.map((h) => {
                const k = hotspotKey(scenario.id, stageData.stageIndex, h.id)
                const isFound = revealed.includes(k)
                const hide = foundHere && !h.isCorrect
                return (
                  <motion.div
                    key={h.id}
                    animate={
                      isFound
                        ? { scale: 1.25, rotate: 4, opacity: 0.9 }
                        : { scale: 1, rotate: 0, opacity: hide ? 0.3 : 1 }
                    }
                    transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                    whileHover={canClick && !foundHere ? { scale: 1.08 } : undefined}
                    onClick={() => handleHotspot(h)}
                    style={{
                      position: 'absolute', left: `${h.x}%`, top: `${h.y}%`, transform: 'translate(-50%,-50%)',
                      zIndex: 12, cursor: canClick && !foundHere ? 'pointer' : 'default',
                      pointerEvents: canClick && !foundHere ? 'auto' : 'none',
                      animation: shakeId === h.id ? 'tqShake 0.25s ease 2' : 'none',
                    }}
                  >
                    {/* equal hint pulse on every hotspot — never gives the answer away */}
                    <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,220,150,0.6) 0%, transparent 70%)', animation: 'tqPulse 3s ease-in-out infinite', pointerEvents: 'none' }} />
                    <ShapeArt shape={h.shape} />

                    {isFound && (
                      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, pointerEvents: 'none' }}>
                        {Array.from({ length: 12 }).map((_, i) => (
                          <span
                            key={i}
                            style={{
                              position: 'absolute', width: 5, height: 5, borderRadius: '50%',
                              background: GOLD[i % GOLD.length],
                              '--tqx': `${Math.round(Math.cos((i / 12) * Math.PI * 2) * 60)}px`,
                              '--tqy': `${Math.round(Math.sin((i / 12) * Math.PI * 2) * 55)}px`,
                              animation: `tqSpark ${800 + (i % 4) * 120}ms ease-out ${(i % 5) * 0.04}s forwards`,
                            } as React.CSSProperties}
                          />
                        ))}
                      </div>
                    )}
                  </motion.div>
                )
              })}

              {/* Layer 6 — reveal banner */}
              <AnimatePresence>
                {foundHere && (
                  <motion.div
                    initial={{ y: -60, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -60, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                    style={{ position: 'absolute', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 32, width: 'min(76%, 420px)' }}
                  >
                    <div style={{ ...parchment, textAlign: 'center' }}>
                      {showEn && <div style={{ fontSize: 16, fontWeight: 800, color: '#4a2f18' }}>{stageData.onFoundReveal.en}</div>}
                      {showHi && <div style={{ fontSize: 16, fontWeight: 600, fontFamily: DEVANAGARI, color: '#6b5030', marginTop: 2 }}>{stageData.onFoundReveal.hi}</div>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* soft miss nudge */}
              <AnimatePresence>
                {missMsg && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    style={{
                      position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 32,
                      background: 'rgba(250,240,220,0.95)', borderRadius: 999, padding: '5px 14px',
                      fontSize: 14, fontWeight: 700, color: '#6b5030', whiteSpace: 'nowrap',
                    }}
                  >
                    {showEn && 'Not this one — try talking about it again'}
                    {language === 'both' && ' · '}
                    {showHi && <span style={{ fontFamily: DEVANAGARI }}>यह नहीं — फिर से बात करके देखो</span>}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Layer 7 — stage header */}
              <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 30, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderRadius: 20, background: 'rgba(250,240,220,0.95)', boxShadow: '0 4px 14px rgba(0,0,0,0.28)', fontSize: 16, fontWeight: 800, color: '#5a3a1a', whiteSpace: 'nowrap' }}>
                  <span>🧭</span>
                  {showEn && <span>{scenario.title_en}</span>}
                  {showHi && <span style={{ fontFamily: DEVANAGARI, fontWeight: 600 }}>{scenario.title_hi}</span>}
                  <span style={{ opacity: 0.55 }}>Stage {stageIdx + 1} of {scenario.stages.length}</span>
                  <span style={{ background: badge.bg, color: badge.color, borderRadius: 999, padding: '1px 7px', fontSize: 13, textTransform: 'capitalize' }}>{level}</span>
                  <span style={{ opacity: 0.45, fontSize: 13 }}>{questIdx + 1}/{levelScenarios.length}</span>
                </div>

                {isT && (
                  <div style={{ display: 'flex', background: 'rgba(250,240,220,0.95)', borderRadius: 999, padding: 2, boxShadow: '0 4px 14px rgba(0,0,0,0.28)' }}>
                    {([['en', 'EN'], ['hi', 'हिं'], ['both', 'Both']] as [Lang, string][]).map(([key, txt]) => (
                      <button
                        key={key}
                        onClick={() => write({ 'moduleState.tqLanguage': key })}
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

              {/* therapist level chips */}
              {isT && (
                <div style={{ position: 'absolute', top: 44, left: '50%', transform: 'translateX(-50%)', zIndex: 30, display: 'flex', gap: 4 }}>
                  {LEVEL_ORDER.map((l) => (
                    <button
                      key={l}
                      onClick={() => loadScenario(scenariosFor(l)[0].id, l)}
                      style={{
                        padding: '2px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 800, textTransform: 'capitalize',
                        fontFamily: NUNITO, border: 'none',
                        background: level === l ? 'rgba(74,124,111,0.85)' : 'rgba(250,240,220,0.85)',
                        color: level === l ? '#fff' : '#8a6a4a',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}

              {/* Layer 8 — role card. Each person sees ONLY their own half. */}
              <div style={{ position: 'absolute', top: 78, [isT ? 'left' : 'right']: 16, zIndex: 25, width: 200 } as React.CSSProperties}>
                <div style={parchment}>
                  <div style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderStyle: 'solid', borderWidth: '0 14px 14px 0', borderColor: 'transparent rgba(120,80,40,0.2) transparent transparent' }} />
                  <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', color: '#8a5a2a', marginBottom: 6, letterSpacing: 0.3 }}>
                    {isSearcher ? '🔍 You are searching this room' : '🗝️ You hold the clue'}
                  </div>
                  {isSearcher ? (
                    <>
                      {showEn && <div style={{ fontSize: 14, fontWeight: 700, color: '#2c1f0e', lineHeight: 1.4 }}>{stageData.searcherPrompt.en}</div>}
                      {language === 'both' && <div style={{ height: 1, background: 'rgba(120,80,40,0.18)', margin: '6px 0' }} />}
                      {showHi && <div style={{ fontSize: 14, fontWeight: 600, fontFamily: DEVANAGARI, color: '#6b5540', lineHeight: 1.5 }}>{stageData.searcherPrompt.hi}</div>}
                    </>
                  ) : (
                    <>
                      {showEn && <div style={{ fontSize: 14, fontWeight: 700, color: '#2c1f0e', lineHeight: 1.4 }}>{stageData.decoderClue.en}</div>}
                      {language === 'both' && <div style={{ height: 1, background: 'rgba(120,80,40,0.18)', margin: '6px 0' }} />}
                      {showHi && <div style={{ fontSize: 14, fontWeight: 600, fontFamily: DEVANAGARI, color: '#6b5540', lineHeight: 1.5 }}>{stageData.decoderClue.hi}</div>}
                    </>
                  )}
                </div>
              </div>

              {/* locked / waiting hint */}
              {!canClick && !foundHere && (
                <div style={{ position: 'absolute', bottom: 24, left: 16, zIndex: 30, fontSize: 13, fontWeight: 700, color: 'rgba(255,240,215,0.75)', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
                  {isLocked && !isT ? 'Therapist is controlling' : isSearcher ? '' : 'Your partner is searching — tell them what your clue says'}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
