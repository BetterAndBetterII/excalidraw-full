package main

import (
	"embed"
	_ "embed"
	"excalidraw-complete/handlers/api/documents"
	"excalidraw-complete/handlers/api/firebase"
	"excalidraw-complete/handlers/api/kv"
	"excalidraw-complete/handlers/api/openai"
	"excalidraw-complete/handlers/auth"
	authMiddleware "excalidraw-complete/middleware"
	"excalidraw-complete/stores"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
	"github.com/sirupsen/logrus"
	"github.com/zishang520/engine.io/v2/types"
	"github.com/zishang520/engine.io/v2/utils"
	socketio "github.com/zishang520/socket.io/v2/socket"
)

type (
	UserToFollow struct {
		SocketId string `json:"socketId"`
		Username string `json:"username"`
	}

	OnUserFollowedPayload struct {
		UserToFollow UserToFollow `json:"userToFollow"`
		Action       string       `json:"action"` // "FOLLOW" | "UNFOLLOW"
	}
)

//go:embed all:frontend
var assets embed.FS

func handleUI() http.HandlerFunc {
	sub, err := fs.Sub(assets, "frontend")
	if err != nil {
		panic(err)
	}

	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		// If the path is empty, it means it's the root, so serve index.html
		if path == "/" || path == "" {
			path = "/index.html"
		}

		// Check if the file exists in the embedded filesystem.
		f, err := sub.Open(strings.TrimPrefix(path, "/"))
		if err != nil {
			// If the file does not exist, and it's not a request for a static asset (like .js, .css),
			// then it's likely a client-side route. In that case, we should serve the index.html
			// and let the client-side router handle it.
			if os.IsNotExist(err) && !strings.Contains(path, ".") {
				path = "/index.html"
				f, err = sub.Open("index.html")
			} else {
				// It's a genuine 404 for a missing asset.
				http.NotFound(w, r)
				return
			}
		}

		if err != nil {
			// If we still have an error, something is wrong.
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		defer f.Close()

		fileContent, err := io.ReadAll(f)
		if err != nil {
			http.Error(w, "Error reading file", http.StatusInternalServerError)
			return
		}

		modifiedContent := strings.ReplaceAll(string(fileContent), "firestore.googleapis.com", "localhost:3002")
		modifiedContent = strings.ReplaceAll(modifiedContent, "ssl=!0", "ssl=0")
		modifiedContent = strings.ReplaceAll(modifiedContent, "ssl:!0", "ssl:0")

		// Set the correct Content-Type based on the file extension
		contentType := http.DetectContentType([]byte(modifiedContent))
		switch {
		case strings.HasSuffix(path, ".js"):
			contentType = "application/javascript"
		case strings.HasSuffix(path, ".html"):
			contentType = "text/html"
		case strings.HasSuffix(path, ".css"):
			contentType = "text/css"
		case strings.HasSuffix(path, ".wasm"):
			contentType = "application/wasm"
		case strings.HasSuffix(path, ".tsx"):
			contentType = "text/typescript"
		case strings.HasSuffix(path, ".png"):
			contentType = "image/png"
		case strings.HasSuffix(path, ".woff2"):
			contentType = "font/woff2"
		}

		// Serve the modified content
		w.Header().Set("Content-Type", contentType)
		_, err = w.Write([]byte(modifiedContent))
		if err != nil {
			http.Error(w, "Error serving file", http.StatusInternalServerError)
			return
		}
	}
}

func setupRouter(store stores.Store) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"https://*", "http://*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Content-Length", "X-CSRF-Token", "Token", "session", "Origin", "Host", "Connection", "Accept-Encoding", "Accept-Language", "X-Requested-With"},
		AllowCredentials: true,
		MaxAge:           300, // Maximum value not ignored by any of major browsers
	}))

	r.Route("/v1/projects/{project_id}/databases/{database_id}", func(r chi.Router) {
		r.Post("/documents:commit", firebase.HandleBatchCommit())
		r.Post("/documents:batchGet", firebase.HandleBatchGet())
	})

	r.Route("/api/v2", func(r chi.Router) {
		// Route for canvases, protected by JWT auth
		r.Group(func(r chi.Router) {
			r.Use(authMiddleware.AuthJWT)
			r.Route("/kv", func(r chi.Router) {
				r.Get("/", kv.HandleListCanvases(store))
				r.Route("/{key}", func(r chi.Router) {
					r.Get("/", kv.HandleGetCanvas(store))
					r.Put("/", kv.HandleSaveCanvas(store))
					r.Delete("/", kv.HandleDeleteCanvas(store))
				})
			})
			r.Route("/chat", func(r chi.Router) {
				r.Post("/completions", openai.HandleChatCompletion())
			})
		})

		// Old routes for anonymous document sharing
		r.Post("/post/", documents.HandleCreate(store))
		r.Route("/{id}", func(r chi.Router) {
			r.Get("/", documents.HandleGet(store))
		})
	})

	r.Route("/auth", func(r chi.Router) {
		r.Get("/login", auth.HandleLogin)
		r.Get("/callback", auth.HandleCallback)
	})

	return r
}

func setupSocketIO() *socketio.Server {
	opts := socketio.DefaultServerOptions()
	opts.SetMaxHttpBufferSize(5000000)
	opts.SetPath("/socket.io")
	opts.SetAllowEIO3(true)
	opts.SetCors(&types.Cors{
		Origin:      "*",
		Credentials: true,
	})
	ioo := socketio.NewServer(nil, opts)

	ioo.On("connection", func(clients ...any) {
		socket := clients[0].(*socketio.Socket)
		me := socket.Id()
		myRoom := socketio.Room(me)
		ioo.To(myRoom).Emit("init-room")
		utils.Log().Println("init room ", myRoom)
		socket.On("join-room", func(datas ...any) {
			room := socketio.Room(datas[0].(string))
			utils.Log().Printf("Socket %v has joined %v\n", me, room)
			socket.Join(room)
			ioo.In(room).FetchSockets()(func(usersInRoom []*socketio.RemoteSocket, _ error) {
				if len(usersInRoom) <= 1 {
					ioo.To(myRoom).Emit("first-in-room")
				} else {
					utils.Log().Printf("emit new user %v in room %v\n", me, room)
					socket.Broadcast().To(room).Emit("new-user", me)
				}

				// Inform all clients by new users.
				newRoomUsers := []socketio.SocketId{}
				for _, user := range usersInRoom {
					newRoomUsers = append(newRoomUsers, user.Id())
				}
				utils.Log().Println(" room ", room, " has users ", newRoomUsers)
				ioo.In(room).Emit(
					"room-user-change",
					newRoomUsers,
				)

			})
		})
		socket.On("server-broadcast", func(datas ...any) {
			roomID := datas[0].(string)
			utils.Log().Printf(" user %v sends update to room %v\n", me, roomID)
			socket.Broadcast().To(socketio.Room(roomID)).Emit("client-broadcast", datas[1], datas[2])
		})
		socket.On("server-volatile-broadcast", func(datas ...any) {
			roomID := datas[0].(string)
			utils.Log().Printf(" user %v sends volatile update to room %v\n", me, roomID)
			socket.Volatile().Broadcast().To(socketio.Room(roomID)).Emit("client-broadcast", datas[1], datas[2])
		})

		socket.On("user-follow", func(datas ...any) {
			// TODO()

		})
		socket.On("disconnecting", func(datas ...any) {
			for _, currentRoom := range socket.Rooms().Keys() {
				ioo.In(currentRoom).FetchSockets()(func(usersInRoom []*socketio.RemoteSocket, _ error) {
					otherClients := []socketio.SocketId{}
					utils.Log().Printf("disconnecting %v from room %v\n", me, currentRoom)
					for _, userInRoom := range usersInRoom {
						if userInRoom.Id() != me {
							otherClients = append(otherClients, userInRoom.Id())
						}
					}
					if len(otherClients) > 0 {
						utils.Log().Printf("leaving user, room %v has users  %v\n", currentRoom, otherClients)
						ioo.In(currentRoom).Emit(
							"room-user-change",
							otherClients,
						)

					}

				})

			}

		})
		socket.On("disconnect", func(datas ...any) {
			socket.RemoveAllListeners("")
			socket.Disconnect(true)
		})
	})
	return ioo

}

func waitForShutdown(ioo *socketio.Server) {
	exit := make(chan struct{})
	SignalC := make(chan os.Signal)

	signal.Notify(SignalC, os.Interrupt, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)
	go func() {
		for s := range SignalC {
			switch s {
			case os.Interrupt, syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT:
				close(exit)
				return
			}
		}
	}()

	<-exit
	ioo.Close(nil)
	os.Exit(0)
	fmt.Println("Shutting down...")
	// TODO(patwie): Close other resources
	os.Exit(0)
}

func main() {
	// Load .env file
	if err := godotenv.Load(); err != nil {
		logrus.Info("No .env file found")
	}

	listenAddress := flag.String("listen", ":3002", "The address to listen on.")
	logLevel := flag.String("loglevel", "info", "The log level (debug, info, warn, error).")
	flag.Parse()

	level, err := logrus.ParseLevel(*logLevel)
	if err != nil {
		logrus.Fatalf("Invalid log level: %v", err)
	}
	logrus.SetLevel(level)
	logrus.SetFormatter(&logrus.TextFormatter{
		FullTimestamp: true,
	})

	auth.InitAuth()
	openai.Init()
	store := stores.GetStore()

	r := setupRouter(store)

	ioo := setupSocketIO()
	r.Mount("/socket.io/", ioo.ServeHandler(nil))
	r.NotFound(handleUI())

	logrus.WithField("addr", *listenAddress).Info("starting server")
	go func() {
		if err := http.ListenAndServe(*listenAddress, r); err != nil {
			logrus.WithField("event", "start server").Fatal(err)
		}
	}()

	logrus.Debug("Server is running in the background")
	waitForShutdown(ioo)
}
