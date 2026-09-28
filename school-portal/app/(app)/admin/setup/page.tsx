'use client'
import { useState } from 'react'
import { PageHead, Tabs } from '@/components/ui'
import { ClassesTab, GradesTab, PeriodsTab, ScaleTab, SettingsTab, SubjectsTab, TeachingTab, YearsTab } from '@/components/SetupTabs'

export default function Setup() {
  const [tab, setTab] = useState('years')
  return (
    <>
      <PageHead title="School set-up" sub="Do these once, in this order: year → grades → subjects → periods → classes → who teaches what" />
      <Tabs
        tabs={[['years', '1. Years'], ['grades', '2. Grades'], ['subjects', '3. Subjects'], ['periods', '4. Periods'], ['classes', '5. Classes'], ['teaching', '6. Who teaches what'], ['scale', 'Grade scale'], ['settings', 'Rules & settings']]}
        value={tab} onChange={setTab}
      />
      {tab === 'years' && <YearsTab />}
      {tab === 'grades' && <GradesTab />}
      {tab === 'subjects' && <SubjectsTab />}
      {tab === 'periods' && <PeriodsTab />}
      {tab === 'classes' && <ClassesTab />}
      {tab === 'teaching' && <TeachingTab />}
      {tab === 'scale' && <ScaleTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  )
}
