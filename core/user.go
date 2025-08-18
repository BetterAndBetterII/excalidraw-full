package core

import "time"

type (
	User struct {
		ID        uint      `json:"id" gorm:"primarykey"`
		Subject   string    `json:"subject" gorm:"uniqueIndex"`
		Login     string    `json:"login" gorm:"uniqueIndex"`
		Email     string    `json:"email"`
		AvatarURL string    `json:"avatarUrl"`
		Name      string    `json:"name"`
		CreatedAt time.Time `json:"createdAt"`
		UpdatedAt time.Time `json:"updatedAt"`
	}
)
