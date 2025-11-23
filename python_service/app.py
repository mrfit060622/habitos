# python_service/app.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, sqlite3, calendar, datetime
import pandas as pd
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Flowable
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors

app = FastAPI()

DB_PATH = os.environ.get('HABITS_DB_PATH', os.path.join(os.getcwd(), 'habitos.db'))
REPORTS_DIR = os.environ.get('REPORTS_DIR', os.path.join(os.getcwd(), 'reports'))
os.makedirs(REPORTS_DIR, exist_ok=True)

class ReportRequest(BaseModel):
    userId: int
    year: int = None
    month: int = None

# ------------------ CLASSE PARA BARRA MELHORADA ------------------
class BarGraph(Flowable):
    AREA_COLORS = {
        'Alma': colors.HexColor("#3498db"),
        'Corpo': colors.HexColor("#e74c3c"),
        'Espírito': colors.HexColor("#9b59b6"),
        'Mente': colors.HexColor("#f1c40f"),
        'Relacionamentos': colors.HexColor("#1abc9c"),
        'Tempo/Lazer': colors.HexColor("#e67e22"),
        'Trabalho/Recursos': colors.HexColor("#2ecc71")
    }

    def __init__(self, label, value, max_value=10, width=350, height=20):
        super().__init__()
        self.label = label
        self.value = value
        self.max_value = max_value
        self.width = width
        self.height = height
        self.color = self.AREA_COLORS.get(label, colors.green)

    def draw(self):
        # Label à esquerda
        self.canv.setFont("Helvetica-Bold", 11)
        self.canv.drawString(0, self.height / 4, self.label)

        # Barra de fundo
        bar_x = 120
        bar_width = self.width
        self.canv.setStrokeColor(colors.black)
        self.canv.setLineWidth(1)
        self.canv.rect(bar_x, 0, bar_width, self.height, stroke=1, fill=0)

        # Barra preenchida proporcional
        fill_width = (self.value / self.max_value) * bar_width
        self.canv.setFillColor(self.color)
        self.canv.rect(bar_x, 0, fill_width, self.height, stroke=0, fill=1)

        # Valor à direita
        self.canv.setFillColor(colors.black)
        self.canv.setFont("Helvetica", 10)
        self.canv.drawString(bar_x + bar_width + 10, self.height / 4, f"{self.value:.2f}")

# ---------------- FUNÇÃO RELATÓRIO ------------------
@app.post('/relatorio')
def gerar_relatorio(req: ReportRequest):
    userId = req.userId
    year = req.year or datetime.date.today().year
    month = req.month or datetime.date.today().month

    last_day = calendar.monthrange(year, month)[1]
    start_date = f"{year}-{month:02d}-01"
    end_date = f"{year}-{month:02d}-{last_day:02d}"

    # Conecta no SQLite
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query(
        "SELECT date, area, value FROM records WHERE userId = ? AND date BETWEEN ? AND ?",
        conn,
        params=(userId, start_date, end_date)
    )
    conn.close()

    if df.empty:
        raise HTTPException(status_code=404, detail='Nenhum dado para o período')

    df['date'] = pd.to_datetime(df['date'])

    # Calcular média por área baseada na quantidade de dias do mês
    days_in_month = last_day
    areas = df['area'].unique()
    summary = []
    for area in areas:
        area_values = df[df['area'] == area].set_index('date')['value']
        # somatório dividido por número de dias do mês
        mean_value = area_values.reindex(pd.date_range(start=start_date, end=end_date), fill_value=0).mean()
        summary.append({'area': area, 'mean': mean_value * 10})  # escala 0-10

    # ---------------- GERA PDF ----------------
    pdf_path = os.path.join(REPORTS_DIR, f'relatorio_{userId}_{year}_{month:02d}.pdf')
    doc = SimpleDocTemplate(pdf_path, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph(f'Relatório de Hábitos - Usuário {userId}', styles['Title']))
    story.append(Spacer(1, 18))
    story.append(Paragraph(f'Período: {start_date} a {end_date}', styles['Heading3']))
    story.append(Spacer(1, 24))

    # Adiciona barras para cada área
    for s in summary:
        story.append(BarGraph(s['area'], s['mean']))
        story.append(Spacer(1, 16))  # aumenta espaçamento

    doc.build(story)

    return {
        'pdf': pdf_path,
        'summary': summary
    }
