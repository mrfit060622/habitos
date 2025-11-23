// ---------------- AGENDA DE HÁBITOS ----------------
// Cada registro define um hábito, seu horário e contexto motivacional.
// Benefícios = o que se ganha praticando.
// Malefícios = o que se perde se negligenciar.
// Prêmio = reforço positivo quando realizado.

const schedules = [
    { 
        time: "08:27", 
        area: "Corpo", 
        tipo: "binario", 
        pergunta: "Você cuidou do corpo hoje?", 
        descricao: "Ex.: Exercício, alimentação, hidratação, sono ou alongamento.",
        beneficios: [
            "Mais energia e disposição ao longo do dia",
            "Sono mais reparador",
            "Fortalecimento físico e imunológico"
        ],
        maleficios: [
            "Cansaço constante e desânimo",
            "Maior chance de doenças e dores",
            "Baixa autoestima e estresse acumulado"
        ],
        premio: "Corpo leve, mente desperta e sensação de conquista pessoal 💪"
    },
    { 
        time: "08:32", 
        area: "Corpo", 
        tipo: "binario", 
        pergunta: "Você cuidou do corpo hoje?", 
        descricao: "Ex.: Exercício, alimentação, hidratação, sono ou alongamento.",
        beneficios: [
            "Melhora da postura e circulação",
            "Aumento da autoconfiança",
            "Controle de peso e bem-estar geral"
        ],
        maleficios: [
            "Tensão muscular e dores recorrentes",
            "Dificuldade de foco e produtividade",
            "Sensação de estagnação física"
        ],
        premio: "Sensação de dever cumprido e vitalidade física 🌟"
    },
    { 
        time: "08:50", 
        area: "Mente", 
        tipo: "binario", 
        pergunta: "Você estimulou sua mente hoje?", 
        descricao: "Ex.: Ler, estudar, resolver problemas ou planejar.",
        beneficios: [
            "Clareza mental e foco ampliado",
            "Melhoria na memória e aprendizado",
            "Capacidade de tomar decisões com calma"
        ],
        maleficios: [
            "Procrastinação e desorganização mental",
            "Dificuldade de aprendizado",
            "Maior ansiedade e falta de direção"
        ],
        premio: "Mente afiada e confiante 🧠"
    },
    { 
        time: "21:05", 
        area: "Mente", 
        tipo: "binario", 
        pergunta: "Você estimulou sua mente hoje?", 
        descricao: "Ex.: Ler, estudar, resolver problemas ou planejar.",
        beneficios: [
            "Desenvolvimento contínuo e evolução pessoal",
            "Melhor resolução de problemas",
            "Controle emocional diante de desafios"
        ],
        maleficios: [
            "Sensação de estagnação mental",
            "Baixa criatividade e foco",
            "Desmotivação e insegurança"
        ],
        premio: "Mente ativa e consciência tranquila 🧘‍♂️"
    },
    { 
        time: "21:07", 
        area: "Espírito", 
        tipo: "binario", 
        pergunta: "Você alimentou seu espírito hoje?", 
        descricao: "Ex.: Orar, meditar ou praticar gratidão.",
        beneficios: [
            "Paz interior e serenidade",
            "Conexão com propósito e fé",
            "Maior empatia e amor próprio"
        ],
        maleficios: [
            "Vazio emocional e desmotivação",
            "Estresse e irritabilidade sem causa aparente",
            "Desalinhamento com valores pessoais"
        ],
        premio: "Coração em paz e energia equilibrada ✨"
    },
    { 
        time: "21:08", 
        area: "Alma", 
        tipo: "binario", 
        pergunta: "Você cuidou da sua alma hoje?", 
        descricao: "Ex.: Pausar, criar, ouvir música ou contemplar arte.",
        beneficios: [
            "Sensação de leveza e alegria",
            "Maior sensibilidade e empatia",
            "Inspiração e criatividade fortalecidas"
        ],
        maleficios: [
            "Sensação de vazio ou apatia",
            "Falta de prazer nas pequenas coisas",
            "Desconexão com emoções e valores"
        ],
        premio: "Alma leve e energia renovada 🎨"
    },
    { 
        time: "21:10", 
        area: "Relacionamentos", 
        tipo: "binario", 
        pergunta: "Você se conectou com alguém hoje?", 
        descricao: "Ex.: Conversar, apoiar ou demonstrar carinho.",
        beneficios: [
            "Laços afetivos fortalecidos",
            "Sentimento de pertencimento e apoio",
            "Melhor humor e estabilidade emocional"
        ],
        maleficios: [
            "Isolamento e tristeza",
            "Dificuldade em lidar com conflitos",
            "Sensação de solidão e desconexão"
        ],
        premio: "Coração aquecido e relacionamentos fortalecidos ❤️"
    },
    { 
        time: "19:00", 
        area: "Trabalho/Recursos", 
        tipo: "binario", 
        pergunta: "Você avançou nas suas metas hoje?", 
        descricao: "Ex.: Trabalhar com foco, organizar tarefas ou aprender.",
        beneficios: [
            "Progresso visível nas metas pessoais e profissionais",
            "Sensação de propósito e direção",
            "Mais estabilidade financeira"
        ],
        maleficios: [
            "Sensação de improdutividade e culpa",
            "Acúmulo de tarefas e estresse",
            "Dificuldade de crescimento pessoal"
        ],
        premio: "Orgulho do próprio progresso 💼"
    },
    { 
        time: "21:15", 
        area: "Tempo/Lazer", 
        tipo: "binario", 
        pergunta: "Você aproveitou seu tempo livre?", 
        descricao: "Ex.: Descansar, se divertir, praticar hobbies ou curtir a natureza.",
        beneficios: [
            "Renovação da energia mental e emocional",
            "Melhor qualidade de vida e bem-estar",
            "Aumento da produtividade a longo prazo"
        ],
        maleficios: [
            "Esgotamento físico e mental",
            "Falta de equilíbrio entre vida pessoal e profissional",
            "Sensação de estar sempre sobrecarregado"
        ],
        premio: "Satisfação genuína e leveza para o dia seguinte 🎉"
    }
];

module.exports = schedules;
