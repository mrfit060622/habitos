# relatorio_service.py
import os, sqlite3, calendar, datetime
import pandas as pd
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from app import BarGraph, DB_PATH, REPORTS_DIR

def gerar_relatorio_pdf(userId, year=None, month=None):
    year = year or datetime.date.today().year
    month = month or datetime.date.today().month

    last_day = calendar.monthrange(year, month)[1]
    start_date = f"{year}-{month:02d}-01"
    end_date = f"{year}-{month:02d}-{last_day:02d}"

    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query(
        "SELECT date, area, value FROM records WHERE userId = ? AND date BETWEEN ? AND ?",
        conn,
        params=(userId, start_date, end_date)
    )
    conn.close()

    if df.empty:
        return None, None

    df['date'] = pd.to_datetime(df['date'])
    summary = []
    for area in df['area'].unique():
        area_values = df[df['area'] == area].set_index('date')['value']
        days_range = pd.date_range(start=start_date, end=end_date)
        mean_value = area_values.reindex(days_range, fill_value=0).mean()
        summary.append({'area': area, 'mean': mean_value * 10})

    pdf_path = os.path.join(REPORTS_DIR, f'relatorio_{userId}_{year}_{month:02d}.pdf')

    os.makedirs(REPORTS_DIR, exist_ok=True)
    doc = SimpleDocTemplate(pdf_path, pagesize=A4)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph(f"Relatório {month}/{year} - Usuário {userId}", styles["Title"]))
    story.append(Spacer(1, 18))

    for s in summary:
        story.append(BarGraph(s['area'], s['mean']))
        story.append(Spacer(1, 16))

    doc.build(story)

    return pdf_path, summary
