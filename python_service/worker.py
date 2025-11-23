import time
import firebase_admin
from firebase_admin import credentials, firestore
from relatorio_service import gerar_relatorio_pdf

cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)

db = firestore.client()

def processar_eventos():
    eventos = db.collection("events").where("status", "==", "pending").stream()

    for e in eventos:
        data = e.to_dict()
        print("Processando evento:", data)

        db.collection("events").document(e.id).update({"status": "processing"})

        pdf_path, summary = gerar_relatorio_pdf(
            userId=data["userId"],
            year=data.get("year"),
            month=data.get("month")
        )

        if pdf_path is None:
            db.collection("events").document(e.id).update({
                "status": "error",
                "error": "Sem dados para o período"
            })
            continue

        db.collection("events").document(e.id).update({
            "status": "done",
            "pdfPath": pdf_path,
            "summary": summary
        })

while True:
    processar_eventos()
    time.sleep(5)
