'use client'
import { Button } from './ui'
import { fmtDate } from '@/lib/util'

const num = (v: any) => (v == null ? '–' : Number(v).toString())

/** Prints a frozen report card snapshot. "Print / Save as PDF" uses the browser's print dialog. */
export default function ReportCardView({ data, version, tz = 'Asia/Kolkata' }: { data: any; version?: number; tz?: string }) {
  if (!data) return null
  const att = data.attendance || {}
  return (
    <div>
      <div className="row end no-print" style={{ marginBottom: 12 }}>
        <Button variant="primary" onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>
      <div className="report">
        <h1>{data.school}</h1>
        <div className="sub">Report card · {data.term} · {data.year}{version && version > 1 ? ` · corrected copy (v${version})` : ''}</div>
        <div className="kv">
          <div><span>Student: </span><b>{data.student}</b></div>
          <div><span>Class: </span><b>{data.class}</b></div>
          <div><span>Roll no.: </span><b>{data.roll_no ?? '–'}</b></div>
          <div><span>Login ID: </span><b>{data.login_id}</b></div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Subject</th><th>Exams (marks ÷ maximum, weight)</th><th className="num">%</th><th className="num">Grade</th></tr>
            </thead>
            <tbody>
              {(data.subjects || []).map((s: any) => (
                <tr key={s.subject}>
                  <td><b>{s.subject}</b></td>
                  <td>
                    {(s.exams || []).map((e: any, i: number) => (
                      <div key={i} className="small">{e.exam}: <b>{e.marks == null ? 'absent' : num(e.marks)}</b> ÷ {num(e.max)} <span className="muted">(×{num(e.weight)})</span></div>
                    ))}
                  </td>
                  <td className="num">{num(s.percent)}</td>
                  <td className="num"><b>{s.grade ?? '–'}</b></td>
                </tr>
              ))}
              {(data.subjects || []).length === 0 && <tr><td colSpan={4} className="muted">No marks recorded for this term.</td></tr>}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><b>Overall</b> <span className="small muted">(weighted marks ÷ weighted maximum)</span></td>
                <td className="num"><b>{num(data.overall?.percent)}</b></td>
                <td className="num"><b>{data.overall?.grade ?? '–'}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p style={{ marginTop: 14 }}>
          <b>Attendance (year to date): </b>
          {att.percent == null ? 'no attendance recorded' : `${att.percent}%`} · Present {att.present ?? 0}, Late {att.late ?? 0}, Absent {att.absent ?? 0}, Leave {att.leave ?? 0}
        </p>
        {data.remarks?.teacher && <p><b>Class teacher's remark: </b>{data.remarks.teacher}</p>}
        {data.remarks?.principal && <p><b>Principal's remark: </b>{data.remarks.principal}</p>}
        <p className="small muted" style={{ marginTop: 20 }}>Generated {fmtDate(String(data.generated_at || '').slice(0, 10))}</p>
      </div>
    </div>
  )
}
