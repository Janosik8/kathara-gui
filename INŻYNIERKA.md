# Capabilities

# **Kathara GUI**  **System Capabilities and Scenarios**

### **1\. Visual Topology and Addressing Design**

**Description:** This capability replaces the manual, text-based creation of `lab.conf` files with an intuitive graphical interface. It allows users to visually build network structures. The tool must be highly flexible: for instructors, it provides automated assistance in generating and validating IP addressing plans to reduce design time. For students, these automated assistants can be restricted to test their knowledge. **Output:** Generation of a ready `lab.conf` and device-specific configuration files. **Directional Assumption:** The initial topology generation process is driven by the instructor; the tool should streamline this process. The resulting topology can be checked for errors.

**Scenario A: Instructor Designing a Base Exam**

* **Step 1:** The instructor opens the application and creates a new workspace.  
* **Step 2:** They drag and drop router icons to map out a network.  
* **Step 3:** The Addressing Plan Configurator automatically prompts them to define subnets for the drawn links, verifying there are no overlapping IP pools.

**Scenario B: Student Practice in Restricted Mode**

* **Step 1:** A student uses the tool to build a topology from scratch for a homework assignment.  
* **Step 2:** They draw the connections and manually input the IP addresses and subnet masks.  
* **Step 3:** Because the automated calculator is disabled (via Capability 8), the system accepts the input without correcting it, forcing the student to verify their own subnet math.

**Scenario C: Designing a Complex Data Center Fabric**

* **Step 1:** A user wants to simulate a dense Spine-Leaf data center architecture.  
* **Step 2:** They utilize the GUI's alignment tools and grid snapping to neatly organize dozens of nodes.  
* **Step 3:** The visual interface allows them to easily track the dense web of connections that would be a nightmare to read and manage in a plain-text `lab.conf` file.

### **2\. Iterative Scenario Development, Modification, and Variant Creation**

**Description:** Modifying an existing scenario setup has traditionally been a tedious process. This capability allows users to seamlessly load an existing "base scenario" and visually iterate upon it to create multiple variants (e.g., for different student groups, or scaling up a network) without ever touching the underlying text files.

**Scenario A: Creating Exam Variants by examinators to Prevent Cheating** 

* **Step 1:** The examiner loads a saved "Base Exam" topology.  
* **Step 2:** For Group A, they delete a core link and add a backup path, saving it as "Variant A".  
* **Step 3:** They reload the base file. For Group B, they add an entirely new router, saving it as "Variant B". The addressing calculator automatically adjusts IPs for both variants without overlapping.

**Scenario B: Scaling Up an Existing Network**

* **Step 1:** An instructor wants to extend a previous week's lab (a single-site LAN) into a WAN setup.  
* **Step 2:** They load last week's state, select the existing nodes, and visually group them as "Site 1".  
* **Step 3:** They duplicate the setup to create "Site 2" and draw a single WAN link between them, instantly generating a new, complex lab without starting from scratch.

**Scenario C: Rapid Bug Fixing in Exam Scenarios**

* **Step 1:** During an exam test-run, the instructor realizes a specific link creates a physically impossible loop that breaks the intended routing logic.  
* **Step 2:** Instead of digging through `lab.conf` collision domains to find the exact line, they load the GUI, click the problematic link, and hit "Delete."  
* **Step 3:** They click "Save," and the application instantly rewrites the configuration files flawlessly.

### **3\. Automated Configuration and Deployment**

**Description:** This feature bridges the gap between the visual design and the actual Kathara environment. It automatically generates all necessary native configuration files in the background and instantly deploys the virtual network containers with a single click, allowing users to focus on network concepts rather than file management.

**Scenario A: Student Deploying a Provided Exam**

* **Step 1:** The student loads the topology file provided by the instructor into the GUI.  
* **Step 2:** The student clicks a single "Deploy Laboratory" button.  
* **Step 3:** The application automatically translates the visual layout into native Kathara configuration files and instantly spins up the virtual containers.

**Scenario B: Instructor Rapid Prototyping**

* **Step 1:** An instructor is experimenting with a new BGP setup and isn't sure if a specific connection model will work.  
* **Step 2:** They quickly draw the topology in the GUI and hit "Deploy."  
* **Step 3:** The lab starts instantly, allowing the instructor to test the concept immediately without spending 15 minutes manually writing setup scripts. If it fails, they tear it down with one click, modify the GUI (with Capability 2), and deploy again.

**Scenario C: Seamless Resumption of Saved Work**

* **Step 1:** A student loads a previously exported state (from Capability 5\) containing both the topology layout and the internal device configurations.  
* **Step 2:** They click "Deploy."  
* **Step 3:** The system not only sets up the `lab.conf` but automatically pushes the saved `.startup` scripts and configurations into the containers, bringing the lab exactly back to where the student left off.

### **4\. Infrastructure Verification and Diagnostics**

**Description:** To ensure that the baseline infrastructure is functioning properly before advanced routing protocols are applied, this capability offers automated diagnostic tools. It runs initial tests on direct connections to instantly identify and highlight any underlying physical, data-link, or L3 misconfigurations.

**Scenario A: Base Topology Verification**

* **Step 1:** A user finishes deploying a complex lab and wants to ensure the baseline is functional.  
* **Step 2:** They click "Verify Infrastructure."  
* **Step 3:** The application executes automated `ping` scripts across all direct links. The GUI updates, glowing successful links green and failed links red, confirming the base setup is ready for routing configuration.

**Scenario B: Troubleshooting a Physical Layer Mistake**

* **Step 1:** A student deploys an exam but cannot establish an OSPF adjacency.  
* **Step 2:** They run the diagnostic tool. A link between R1 and R2 glows red.  
* **Step 3:** The student realizes they visually connected eth0 to eth1, but configured the IP addresses on the wrong interfaces inside the terminal. The tool immediately isolated the problem to a baseline connection issue.

### **5\. State Extraction and Scenario Management**

**Description:** This capability simplifies the management of laboratory states by automatically pulling current running configurations from all active virtual containers. It allows users to effortlessly export, save, reload, and share complete educational scenarios without having to manually log into individual container terminals to copy files.

**Scenario A: Hibernating a Lab Session**

* **Step 1:** A student runs out of time during a 90-minute lab class while configuring BGP.  
* **Step 2:** They click "Export Current State" in the GUI. The application automatically pulls the `run conf` from all active containers.  
* **Step 3:** The student sends the single generated file to his cloud drive, goes home, and loads it into their local Kathara GUI to continue exactly where they left off.

**Scenario B: Submitting a Completed Exam**

* **Step 1:** An exam ends. Instead of zipping multiple chaotic folders or taking screenshots, the student clicks "Export Current State."  
* **Step 2:** The application bundles the visual layout and all running configurations into a single, clean file.  
* **Step 3:** The student uploads this single file to the university's e-learning platform as their final exam submission.

**Scenario C: Automated Grading and Inspection**

* **Step 1:** An instructor downloads a student's exported state file and loads it into their own GUI instance.  
* **Step 2:** The GUI perfectly recreates the student's topology layout.  
* **Step 3:** The instructor can visually inspect the network and deploy it to check the running configurations inside the containers, making the grading process highly efficient.

### 6\. Accessibility and Usability Compliance

Recognizing the legal and ethical imperative of inclusive design, this application is engineered to adhere strictly to the Web Content Accessibility Guidelines (WCAG 2.1), national regulations concerning digital accessibility for public entities, and internal directives of the AGH University. The system prioritizes a polished, reliable experience over an excess of unrefined features, ensuring usability for diverse user groups. Furthermore, special emphasis is placed on creating a reliable and refined tool with an interface fully adapted to accessibility best practices.

**Scenario A: Color Vision Deficiency (Daltonism) Support**

* **Step 1:** A user with Deuteranomaly (red-green color blindness) accesses the application.  
* **Step 2:** The user activates the "Color Blindness Profile" within the accessibility settings.  
* **Step 3:** During the execution of the Infrastructure Verification tool, the user interface substitutes red/green color indicators with distinct structural patterns and symbolic icons to guarantee unequivocal diagnostic feedback.

**Scenario B: Low Vision UI Scaling**

* **Step 1:** A user with visual impairments experiences difficulty perceiving small terminal fonts and interface labels.  
* **Step 2:** The user employs the integrated UI scaling feature to enlarge text dimensions and node icon sizes by 150%.  
* **Step 3:** The graphical user interface dynamically adapts to these parameters, ensuring that connection lines and labels do not overlap or break the canvas layout, thereby remaining fully legible.

**Scenario C: High Contrast Theme for Cognitive and Visual Focus**

* **Step 1:** A student operating in a high-luminance environment or experiencing visual processing strain navigates to the settings menu.  
* **Step 2:** The student selects the compliant "High Contrast Dark Mode".  
* **Step 3:** The canvas background transitions to a dark hue, while network nodes and links are accentuated with stark, neon colors and high-contrast borders, significantly enhancing readability and mitigating ocular fatigue.

### **7\. Shared Working Space (Real-Time Collaboration)**

**Description:** This capability introduces a collaborative environment where multiple users can work on a single network topology simultaneously. It transforms the solitary act of network configuration into a team-based exercise, highly useful for group projects or live troubleshooting sessions.

**Scenario A: Group Project Collaboration**

* **Step 1:** A group of students is tasked with designing a multi-area corporate network. Student A creates a "Shared Session" and sends a link to Students B and C.  
* **Step 2:** All three students join the canvas. Student A builds the core network, while B and C build the branch offices simultaneously.  
* **Step 3:** They see each other's nodes appearing in real-time, completely eliminating the need to merge separate `lab.conf` files later.

**Scenario B: Live Instructor Assistance**

* **Step 1:** A student is stuck on a topology assignment at home and cannot figure out a subnetting issue.  
* **Step 2:** They generate a live share link and send it to the instructor.  
* **Step 3:** The instructor joins the session, visually points out the missing link on the canvas, and demonstrates how to fix it in real-time without needing to send files back and forth.

**Scenario C: ISP Simulation Roleplay**

* **Step 1:** An instructor sets up a massive blank canvas for an "Internet Simulation" lab.  
* **Step 2:** Five different groups of students join the session. Each group is assigned an Autonomous System (AS).  
* **Step 3:** The groups independently build their internal topologies on the same shared canvas, and then visually draw BGP peering links to the other groups' border routers, simulating a real-world multi-ISP environment.

### **8\. Application Services and Mode Management (Feature Toggling)**

**Description:** This capability allows for the granular management of application features based on the context of use. Instructors can enable or disable specific capabilities (like the subnet calculator or diagnostic tools) when creating a scenario, ensuring the tool perfectly matches the pedagogical goals of a specific lab or exam.

**Scenario: Strict Exam Mode**

* **Step 1:** An instructor builds a troubleshooting exam.  
* **Step 2:** Before saving, they open the "Mode Management" tab and explicitly disable the "Subnet Calculator" and "Infrastructure Verification" features.  
* **Step 3:** When students open the exam, these app capabilities are locked. Students are forced to rely entirely on manual terminal commands and their own knowledge to pass.

### **9\. Smart Auto-Layout Engine for Legacy Imports**

**Description:** When users import legacy, text-based `lab.conf` files that lack explicit X/Y visual coordinates, this capability utilizes graph-drawing algorithms  to automatically arrange the nodes. It intelligently spaces out core routers, switches, and edge devices, generating a clean, logical visual representation and preventing a tangled, overlapping mess on the canvas.

**Scenario A: Migrating an Old Database of Scenarios**

* **Step 1:** An instructor wants to reuse a library of 50 older Kathara scenarios that were created purely in text editors over the last few years.  
* **Step 2:** They import a legacy `lab.conf` file into the GUI.  
* **Step 3:** The Auto-Layout Engine parses the file, analyzes the connection links, and automatically draws a well structured topology on the canvas, instantly modernizing the old material without any manual drag-and-drop effort.

**Scenario B: Importing External Text Topologies**

* **Step 1:** A student finds a raw `lab.conf` snippet for a complex BGP lab on a public GitHub repository and wants to visualize it to understand it better.  
* **Step 2:** They paste the text into the application's import module.  
* **Step 3:** The system generates the visual nodes and links, automatically organizing the distinct Autonomous Systems into separate visual clusters based on their interconnections, allowing the student to grasp the network structure at a glance.

**Scenario C: Untangling a Messy Workspace**

* **Step 1:** A user has been manually building and expanding a massive topology for an hour, and the canvas has become a chaotic, unreadable web of crossing wires and randomly placed nodes.  
* **Step 2:** They select all nodes and click the "Auto-Arrange Topology" button.  
* **Step 3:** The algorithm recalculates the positions, actively minimizing link crossings and snapping nodes into a clear hierarchical layout (e.g., Core-Distribution-Access), instantly cleaning up the visual workspace.

# Opis\_ang

***An intelligent graphical environment for modeling, configuration automation and verification of network topologies in the Kathara environment***  
   
*Bachelor of Engineering Thesis*  
**Field of study:** Teleinformatics  
**Language:** English  
**Student:** Jan Ogiegło, B.Eng.  
**Student ID:** 420015

**Scope:**

Developing network topologies for educational classes and laboratory experiments in the Kathara environment is currently a highly manual, tedious, and time-consuming process. This manual approach distracts from the core purpose of using the platform, which is to configure routing protocols and study network behavior. Instead of focusing on fundamental networking concepts, users are often forced to manage the intricacies of environment-specific files, such as `lab.conf`. Consequently, manually editing these configuration files every time an exam scenario is created, modified, or fixed significantly burdens instructors and creates an artificial barrier for students trying to translate their concepts into a functioning network. The aim of this thesis is to create a custom application that automates repetitive tasks and relieves the user of the burden of file management. The application will not replace the designer in generating ideas, but will serve as a supporting tool to seamlessly translate a concept into a ready-to-use scenario.

The application will offer users four main capabilities. First, it will enable the specification of network topologies and addressing plans using an interactive graphical editor, which will significantly reduce the design process time. Second, it will provide immediate translation of the graphical representation into native Kathara configuration files, supporting deployment and convenient scenario management. Third, it will provide mechanisms for initial verification and test deployment to ensure that the baseline infrastructure operates correctly. Fourth, the application will automate the retrieval of the current configuration from all running devices, eliminating the need to manually log into individual containers to copy files. This will allow for instant exporting and saving of the entire laboratory's state, facilitating the subsequent resumption of work or the transfer of the environment to another computer.

Special emphasis during the system design will be placed on usability considerations. The priority is to create a reliable and refined tool with an interface fully adapted to accessibility best practices.

**Expected results:**

* As a result of this thesis, a refined application will be developed, offering:  
* A graphical network topology editor for the visual specification of nodes and connections.  
* A configurator assisting the user in defining and verifying the addressing plan.  
* A configuration file generator supporting direct deployment to the Kathara environment.  
* A configuration retrieval mechanism from the running containers of the virtual environment.  
* A module for simple management of educational scenarios, including their saving and loading.  
* An accessible graphical user interface that incorporates accessibility standards.

# Opis\_pl

**Inteligentne środowisko graficzne do modelowania, automatyzacji konfiguracji i weryfikacji topologii sieciowych w środowisku Kathara.**  
*An intelligent graphical environment for modeling, configuration automation and verification of network topologies in the Kathara environment*  
   
*Praca dyplomowa inżynierska*  
*Kierunek: Teleinformatyka*  
*Język: angielski*  
*Dyplomant: inż. Jan Ogiegło*  
*Indeks:* 420015

**Zakres:**

Opracowywanie topologii sieciowych na potrzeby zajęć dydaktycznych i eksperymentów laboratoryjnych w środowisku Kathara jest obecnie procesem wysoce manualnym, żmudnym i czasochłonnym. Ręczna edycja plików konfiguracyjnych każdorazowo przy tworzeniu, modyfikacji lub naprawie scenariusza egzaminacyjnego znacząco obciąża prowadzących, a studentom utrudnia przeniesienie koncepcji na działającą sieć. Celem pracy jest stworzenie autorskiej aplikacji, która zautomatyzuje powtarzalne czynności i zdejmie z użytkownika ciężar zarządzania plikami. Aplikacja nie zastąpi projektanta w kreowaniu pomysłu, lecz posłuży jako narzędzie wspierające w płynnym przełożeniu koncepcji na gotowy scenariusz.

Aplikacja zaoferuje użytkownikom cztery główne możliwości. Po pierwsze, umożliwi specyfikowanie topologii sieci oraz planu adresacyjnego za pomocą interaktywnego edytora graficznego, co drastycznie skróci proces projektowania. Po drugie, zapewni natychmiastową translację graficznej reprezentacji na natywne pliki konfiguracyjne Kathary, wspierając wdrożenie oraz wygodne zarządzanie scenariuszami. Po trzecie, udostępni mechanizmy wstępnej weryfikacji i wdrożenia testowego, aby upewnić się, że bazowa infrastruktura działa poprawnie. Po czwarte, aplikacja zautomatyzuje pobieranie bieżącej konfiguracji ze wszystkich uruchomionych urządzeń, eliminując konieczność ręcznego logowania się do poszczególnych kontenerów w celu kopiowania plików. Pozwoli to na błyskawiczne wyeksportowanie i zapisanie stanu całego laboratorium, co ułatwi późniejsze wznowienie pracy lub przeniesienie środowiska na inny komputer.

Szczególny nacisk podczas projektowania systemu zostanie położony na względy użyteczności. Priorytetem jest stworzenie narzędzia niezawodnego i dopracowanego, którego interfejs będzie w pełni dostosowany do dobrych praktyk dostępności.

**Spodziewany efekt** W ramach pracy powstanie dopracowana aplikacja oferująca:

* Graficzny edytor topologii sieci z wizualnym specyfikowaniem węzłów i połączeń.  
* Konfigurator wspomagający użytkownika w definiowaniu i sprawdzaniu planu adresacyjnego.  
* Generator plików konfiguracyjnych wspierający bezpośrednie wdrożenie do środowiska Kathara.  
* Mechanizm odczytu konfiguracji z działających kontenerów środowiska wirtualnego.  
* Moduł do prostego zarządzania scenariuszami dydaktycznymi, w tym ich zapisu i odczytu.  
* Przystępny interfejs graficzny uwzględniający standardy dostępności.


# Plan szczegółowy nr1\_ang

### **Engineering Project Concept**

**Working Title:** Intelligent graphical environment for modeling, automating, and verifying network topologies in the Kathara environment.

**Main Goal:** To create a tool (a cross-platform desktop application) that relieves students and lecturers from the burden of manual configuration file management, offering a graphical interface integrated directly with Docker and an AI assistant supporting the learning process.

### **1\. MoSCoW Analysis (Requirements Prioritization)**

#### **MUST HAVE**

* **Graphical topology editor:** Ability to add routers, PCs, switches, and connect them with cables (Drag & Drop).  
* **Node configurator:** Interface for assigning IP addresses, subnet masks, and activating daemons (OSPF, BGP, RIP) for each device.  
* **Kathara file generator:** Algorithm that creates the correct folder structure, `lab.conf` files, empty FRR files, and `.startup` scripts.  
* **Network scenario management (Import/Export):** Creating complete, custom laboratory scenarios, and then saving, importing, and exporting them as unified packages (e.g., compressed `.zip` files containing the topology and additional materials).  
* **Built-in laboratory library:** The application will by default be equipped with a set of predefined, ready-to-run network scenarios, allowing users to practically master the configuration of BGP, OSPF, RIP protocols, and static routing at a fundamental level.  
* **"Live" configuration retrieval (State Persistence):** Direct integration with Docker allowing the application to pull the current state (`frr.conf`, daemons, `ip addr`) from running containers and update the project in the GUI.  
* **Addressing assistance:** Automatic checking for IP conflicts (warning about different subnets residing in the same collision domain).

#### **SHOULD HAVE**

* **Integrated viewer and manual import (PDF):** A panel allowing the import of custom PDF files (e.g., shared by the instructor) as instructions for a given "lab," with a convenient preview inside the application while performing tasks.  
* **AI Lab Generator (Intent-based networking):** A text field where the user describes the topology (e.g., "Generate a lab with BGP and MED"), and the AI model returns a structure that the application renders as a ready-made schematic.  
* **AI Network Tutor:** Ability to "ask" the AI about an error. The application sends the router's configuration along with the student's prompt to the model, and the assistant analyzes the problem.

#### **COULD HAVE (Innovative \- Level Up)**

* **Multiplayer Mode:** Simulating a global environment where multiple students connect and interact within a single, distributed Kathara network (e.g., as separate ISPs).  
* **Automatic solution verification:** A test engine executing defined scripts (e.g., automated pinging or routing table checks) after the laboratory is launched.  
* **Advanced Auto-Layout:** Graph algorithms (e.g., force-directed) for aesthetically and clearly arranging complex topologies generated from AI prompts.

#### **WON'T HAVE (Out of scope for the current engineering thesis)**

* **Building an LLM from scratch:** The project does not involve training a foundational language model from zero. However, fine-tuning an existing Open Source model on specialized datasets containing FRR/Kathara configurations is acceptable.  
* **Full cloud execution (Cloud Hosting):** The application will not be a SaaS platform compiling and running containers on external servers. The runtime environment remains the local Docker daemon on the user's machine.  
* **Mobile application:** The interface will be optimized exclusively for computer screens (native desktop application), due to the specifics of drawing network topologies.

### **2\. Functional Requirements**

The system must allow the user to:

* Graphically model networks (placing, connecting, and editing nodes).  
* Utilize built-in educational scenarios (BGP, OSPF, RIP, static routing).  
* Create custom scenarios, upload laboratory manuals in PDF format, and export ready-made packages to share with other users.  
* Generate a ready-to-run Kathara file structure.  
* Synchronize state in both directions: GUI \-\> Files \-\> Docker and Docker \-\> Files \-\> GUI.  
* Send queries to the AI assistant with automatic attachment of the current technical context (configuration).  
* Generate visual topologies based on text processed by the artificial intelligence model.

### **3\. Non-Functional Requirements**

* **Technology:** A desktop application written in Python (using frameworks such as Tkinter, CustomTkinter, or PyQt/PySide). The application will be adapted for cross-platform compilation (using tools like PyInstaller), allowing the generation of independent executable files (standalone) for macOS, Linux, and Windows systems, requiring no Python environment installation from the user.  
* **Hardware Performance:** The application running in the background (parsing files, querying Docker) should not noticeably burden the host resources needed to run the network simulation itself.  
* **AI Flexibility:** The architecture of the AI module must allow for an easy change of the "provider" (e.g., switching from the OpenAI API to a locally hosted, fine-tuned Llama 3 / Mistral model).  
* **State Fault Tolerance:** The application must safely handle situations where the user manually closes Kathara containers from the terminal (handling state drift between the GUI and Docker).

### **4\. Problem Analysis and Reality Check**

* **Docker State Management (Must Have):** This requires a solid backend architecture. The application must use modules such as `subprocess` (for `docker ps`, `docker cp` commands) or the official `docker-py` library to connect to the Docker API. This is necessary to read configuration files in real-time, without user intervention, from containers with specific names generated by Kathara.  
* **AI Fine-Tuning (Should/Could Have):** Although training a model from scratch is out of the question, fine-tuning a smaller model on correct and incorrect FRR configuration files could be an outstanding and innovative research element of this engineering thesis.

# Plan szczegółowy nr1

# **Koncepcja Projektu Inżynierskiego**

**Tytuł roboczy:** Inteligentne środowisko graficzne do modelowania, automatyzacji i weryfikacji topologii sieciowych w środowisku Kathara.

**Cel główny:** Stworzenie narzędzia (wieloplatformowej aplikacji desktopowej), które zdejmuje ze studentów i wykładowców ciężar ręcznego zarządzania plikami konfiguracyjnymi, oferując graficzny interfejs zintegrowany bezpośrednio z Dockerem oraz asystentem AI wspierającym proces nauki.

## **1\. Analiza MoSCoW (Priorytetyzacja Wymagań)**

### **MUST HAVE**

* **Graficzny edytor topologii:** Możliwość dodawania routerów, PC, switchy oraz łączenia ich kablami (Drag\&Drop).  
* **Konfigurator węzłów:** Interfejs do przypisywania adresów IP, masek i aktywacji demonów (OSPF, BGP, RIP) dla każdego urządzenia.  
* **Generator plików Kathara:** Algorytm tworzący poprawną strukturę folderów, pliki lab.conf, puste pliki FRR oraz skrypty .startup.  
* **Zarządzanie scenariuszami sieciowymi (Import/Eksport):** Tworzenie pełnych, autorskich scenariuszy laboratoryjnych, a następnie ich zapisywanie, importowanie i eksportowanie w postaci zunifikowanych paczek (np. skompresowanych plików .zip zawierających topologię oraz materiały dodatkowe).  
* **Wbudowana biblioteka laboratoriów:** Aplikacja domyślnie będzie wyposażona w zestaw predefiniowanych, gotowych do uruchomienia scenariuszy sieciowych, pozwalających na praktyczne opanowanie konfiguracji protokołów BGP, OSPF, RIP oraz routingu statycznego w podstawowym zakresie.  
* **Pobieranie "żywej" konfiguracji (State Persistence):** Bezpośrednia integracja z Dockerem pozwalająca aplikacji zassać bieżący stan (frr.conf, daemons, ip addr) z działających kontenerów i zaktualizować projekt w GUI.  
* **Wspomaganie adresacji:** Automatyczne sprawdzanie konfliktów IP (ostrzeganie o różnych podsieciach w tej samej domenie kolizyjnej).

  ### **SHOULD HAVE**

* **Zintegrowana przeglądarka i import instrukcji (PDF):** Panel pozwalający na importowanie własnych plików PDF (np. udostępnionych przez prowadzącego) jako instrukcji do danego "laba" oraz ich wygodny podgląd wewnątrz aplikacji podczas wykonywania zadań.  
* **AI Lab Generator (Intent-based networking):** Pole tekstowe, gdzie użytkownik opisuje topologię (np. "Wygeneruj lab z BGP i MED"), a model AI zwraca strukturę, którą aplikacja renderuje jako gotowy schemat.  
* **AI Network Tutor:** Możliwość "zapytania" AI o błąd. Aplikacja wysyła do modelu konfigurację rutera wraz z promptem studenta, a asystent analizuje problem.

  ### **COULD HAVE (Innowacyjne \- Level Up)**

* **Tryb Multiplayer:** Symulowanie globalnego środowiska, gdzie wielu studentów łączy się i wchodzi w interakcje w ramach jednej, rozproszonej sieci Kathara (np. jako osobni ISP).  
* **Automatyczna weryfikacja rozwiązań:** Silnik testowy wykonujący zdefiniowane skrypty (np. automatyczny ping lub sprawdzanie tablicy routingu) po uruchomieniu laboratorium.  
* **Zaawansowany Auto-Layout:** Algorytmy grafowe (np. siłowe) do estetycznego i czytelnego układania skomplikowanych topologii generowanych z promptów AI. 

  ### **WON'T HAVE (Zasięg poza obecną inżynierką)**

* **Budowa modelu LLM od podstaw (From Scratch):** Projekt nie zakłada trenowania fundamentalnego modelu językowego od zera. Dopuszczalne jest jednak dotrenowanie (Fine-Tuning) istniejącego modelu Open Source na specjalistycznych datasetach z konfiguracjami FRR/Kathara.  
* **Pełne wykonanie w chmurze (Cloud Hosting):** Aplikacja nie będzie platformą SaaS kompilującą i uruchamiającą kontenery na serwerach zewnętrznych. Środowiskiem uruchomieniowym pozostaje lokalny demon Dockera na maszynie użytkownika.  
* **Aplikacja mobilna:** Interfejs będzie optymalizowany wyłącznie pod ekrany komputerów (natywna aplikacja desktopowa), ze względu na specyfikę rysowania topologii.

  ## **2\. Wymagania Funkcjonalne**

System musi umożliwiać użytkownikowi:

1. Graficzne modelowanie sieci (umieszczanie, łączenie i edycja węzłów).  
2. Wykorzystywanie wbudowanych scenariuszy dydaktycznych (BGP, OSPF, RIP, routing statyczny).  
3. Tworzenie własnych scenariuszy, wgrywanie instrukcji laboratoryjnych w formacie PDF oraz eksportowanie gotowych paczek w celu podzielenia się z innymi użytkownikami.  
4. Generowanie gotowej do uruchomienia struktury plików Kathara.  
5. Synchronizację stanu w obu kierunkach: GUI \-\> Pliki \-\> Docker oraz Docker \-\> Pliki \-\> GUI.  
6. Wysyłanie zapytań do asystenta AI z automatycznym załączaniem aktualnego kontekstu technicznego (konfiguracji).  
7. Generowanie wizualnych topologii na podstawie tekstu przetworzonego przez model sztucznej inteligencji.

   ## **3\. Wymagania Niefunkcjonalne**

* **Technologia:** Aplikacja desktopowa napisana w języku Python (wykorzystująca frameworki takie jak Tkinter, CustomTkinter lub PyQt/PySide). Aplikacja zostanie przystosowana do kompilacji typu cross-platform (za pomocą narzędzi takich jak PyInstaller), co umożliwi wygenerowanie niezależnych plików wykonywalnych (standalone) dla systemów macOS, Linux oraz Windows, niewymagających od użytkownika instalacji środowiska Python.  
* **Wydajność sprzętowa:** Działanie aplikacji w tle (parsowanie plików, odpytywanie Dockera) nie powinno zauważalnie obciążać zasobów hosta potrzebnych do działania samej symulacji sieciowej.  
* **Elastyczność AI:** Architektura modułu AI musi pozwalać na łatwą zmianę "providera" (np. przełączenie z API OpenAI na lokalnie hostowany, dotrenowany model Llama 3 / Mistral).  
* **Odporność na błędy stanu:** Aplikacja musi bezpiecznie obsługiwać sytuacje, w których użytkownik zamyka kontenery Kathary ręcznie z poziomu terminala (rozjazd stanu między GUI a Dockerem).

  ## **4\. Analiza Problemów i Reality Check**

* **Zarządzanie Stanem z Dockera (Must Have):** Wymaga to solidnej architektury backendowej. Aplikacja musi używać modułów takich jak `subprocess` (do poleceń `docker ps`, `docker cp`) lub oficjalnej biblioteki `docker-py` do łączenia się z Docker API, aby w czasie rzeczywistym, bez ingerencji użytkownika, czytać pliki konfiguracyjne z kontenerów o specyficznych nazwach generowanych przez Katharę.  
* **Fine-Tuning AI (Should/Could Have):** Chociaż trenowanie modelu od zera nie wchodzi w grę, dotrenowanie mniejszego modelu na poprawnych i błędnych plikach konfiguracyjnych FRR może stanowić wybitny i innowacyjny element badawczy tej pracy inżynierskiej.


# Notes

### **Engineering Thesis**

**Engineering thesis \- conversation 2**

* Interaction of several users to this kathara \- isp simulation as a student  
* Non-standard use of already known tools  
* Other connection models than prompt fix, improve to ai  
* Visualizer with chat  
* Level up: intent base networking  
* Think about assigning to other students \- could someone enrich

**Plan:**

* Sit down, write down the plan, concepts, functional and non-functional requirements of the system, nice to have/must have, shall have, wont have,  
* Then it will be easier to define the topic,  
* Read something,  
* Check gemini cli with imported topologies from katara,  
* What was troublesome in katara, what can be improved in this experience.  
* Does linux support multipathing(ecplb) like frr eg in bgp or ospf?  
* Data center scenario in kathara/frr

[https://docs.frrouting.org/en/stable-10.5/](https://docs.frrouting.org/en/stable-10.5/) [https://www.overleaf.com/learn/latex/TikZ\_package](https://www.overleaf.com/learn/latex/TikZ_package)

### **Conversation 3**

* According to mister \[the professor\] it is too much  
* Description \- good only mixing functionality with technology  
* Make a description what this app is supposed to do, what I can do using this application.  
* Thinking about capabilities. What the user will be able to achieve thanks to this app.  
* What we can do so far and what was difficult or inconvenient

**Main problem** \- preparation of the exam takes a mass of time(scenario lab.conf and addressing plan. Doing this a few times because often you need to change, remove, add something. After making the exam by the instructor he can state that the student won't solve this or it is too simple and the lab needs to be modified. In such a situation it is very tedious and taking time. Modification of lab.conf takes a lot of time, is very inconvenient, the whole configuration needs to be done anew and test another idea for the exam with which it can be the same, can be not ideal and turn out to be a version for modification so the process repeats)

Not how? only what?

* **Capability1** \- creating network topology, change from idea for exam 4 to 5 (clicking out a router, changing connection in GUI and not lab.conf)  
* **Capability2** \- practicing topology by the student \- the student will have it easier to transfer his idea to a ready topology to configure  
* **Capability3** \- verification of these topologies (firing it up)(instant deployment with one button)(ping diagnostic on direct links to verify correctness of defined direct connections)  
* **Capability4** \- export run conf  
* Pulling run conf and visualization of previously modified/created topology on another instance of the application or manually in lab.conf  
* Usability considerations \- adaptation to special people (better that it is refined than a lot of unrefined features)  
* Scenario management (export import to GUI)  
* This is enough for the thesis  
* Proposing an addressing plan can be done  
* Chat interface as an addition outline for a master's thesis  
* Scope and goals of the thesis together then mister will describe it and take care of topic approval.  
* Mister will send me the description (old and outdated, will serve as a template for mine) and I will re-edit it. DESCRIPTION: Only description and declaration what I will do what are the goals and expected results.

**TIPS:**

* TIKZ package in latex to create layout before export save router positions in gui, so that after import they are identical. A few topology proposals when labs without router positions are imported.  
* Color blindness is important, you need to see what are the good practices doing an adapted application (element of refining the application)

**Work workflow:**

* First project then presentation to instructors, later implementation  
* Focus more on a refined app.  
* Instructors want frequent reporting and contact eg every 2 weeks for 15 minutes

### **TODO:**

* Write 8 to 10 paragraphs (max 2/3 pages) what I intend to do, what is the goal of the thesis, motivator, what we want to achieve and what will be the expected results. It can be pointed out that there is no such thing and we answer to this need. Write so that it is doable and do not write too detailed to always have room for flexibility when something turns out to be impossible or too time-consuming.  
* Next meeting after I describe these capabilities to myself
