FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV TERM=xterm-256color
ENV COLORTERM=truecolor

# Install packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash bash-completion sudo coreutils findutils grep sed gawk less tree file \
    locales tzdata ca-certificates curl wget net-tools iputils-ping dnsutils \
    netcat openssh-client git vim nano build-essential gcc g++ make cmake \
    python3 python3-pip python3-venv gnupg zip unzip tar gzip bzip2 xz-utils \
    jq htop procps man-db software-properties-common apt-transport-https \
    figlet lolcat neofetch nmap nikto sqlmap hydra \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && locale-gen en_US.UTF-8

WORKDIR /root

# Create CYH Hacking welcome script
RUN cat > /etc/profile.d/00-welcome.sh << 'WELCOME'
#!/bin/bash

# Only show banner if CYH_SKIP_BANNER is NOT set (fresh session)
if [ -z "$CYH_SKIP_BANNER" ]; then

    if [ -t 1 ]; then
        clear
        
        # Colors - CYH Green Theme
        GREEN='\033[38;2;127;255;0m'
        BRIGHT_GREEN='\033[38;2;159;255;64m'
        DARK_GREEN='\033[38;2;95;204;0m'
        RED='\033[38;5;196m'
        WHITE='\033[1;37m'
        GRAY='\033[38;5;245m'
        CYAN='\033[38;5;87m'
        RESET='\033[0m'
        BOLD='\033[1m'
        
        echo ""
        echo -e "${GREEN}  ██████╗██╗   ██╗██╗  ██╗${RESET}"
        echo -e "${GREEN} ██╔════╝╚██╗ ██╔╝██║  ██║${RESET}"
        echo -e "${GREEN} ██║      ╚████╔╝ ███████║${RESET}"
        echo -e "${GREEN} ██║       ╚██╔╝  ██╔══██║${RESET}"
        echo -e "${GREEN} ╚██████╗   ██║   ██║  ██║${RESET}"
        echo -e "${GREEN}  ╚═════╝   ╚═╝   ╚═╝  ╚═╝${RESET}"
        echo ""
        echo -e "${BRIGHT_GREEN}    CanYouHack Terminal${RESET}"
        echo -e "${GRAY}    https://canyouhack.org${RESET}"
        echo ""
        echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${RESET}"
        echo -e "${GREEN}║${RESET}  ${GREEN}>_${RESET}  ${BOLD}${WHITE}CYH Hacking Environment${RESET}  ${GRAY}|${RESET}  ${CYAN}Security Training Platform${RESET}   ${GREEN}║${RESET}"
        echo -e "${GREEN}╠════════════════════════════════════════════════════════════════╣${RESET}"
        echo -e "${GREEN}║${RESET}  ${BRIGHT_GREEN}●${RESET} Hostname: ${WHITE}$(hostname)${RESET}                                       ${GREEN}║${RESET}"
        echo -e "${GREEN}║${RESET}  ${BRIGHT_GREEN}●${RESET} Kernel:   ${WHITE}$(uname -r)${RESET}                          ${GREEN}║${RESET}"
        echo -e "${GREEN}║${RESET}  ${BRIGHT_GREEN}●${RESET} User:     ${WHITE}$(whoami)${RESET}                                             ${GREEN}║${RESET}"
        echo -e "${GREEN}║${RESET}  ${BRIGHT_GREEN}●${RESET} Shell:    ${WHITE}/bin/bash${RESET}                                          ${GREEN}║${RESET}"
        echo -e "${GREEN}╠════════════════════════════════════════════════════════════════╣${RESET}"
        echo -e "${GREEN}║${RESET}  ${GRAY}Tools:${RESET} ${CYAN}nmap${RESET}  ${CYAN}nikto${RESET}  ${CYAN}sqlmap${RESET}  ${CYAN}hydra${RESET}  ${CYAN}python3${RESET}              ${GREEN}║${RESET}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${RESET}"
        echo ""
    fi
fi
WELCOME

# Configure bash with CYH theme
RUN cat > /root/.bashrc << 'BASHRC'
case $- in
    *i*) ;;
      *) return;;
esac

HISTCONTROL=ignoreboth
shopt -s histappend
HISTSIZE=10000
HISTFILESIZE=20000
shopt -s checkwinsize

# CYH Green prompt: canyouhack@root:/path$
PS1='\[\033[38;2;127;255;0m\]canyouhack\[\033[0m\]@\[\033[38;5;196m\]root\[\033[0m\]:\[\033[38;5;87m\]\w\[\033[0m\]\$ '

# Colors
if [ -x /usr/bin/dircolors ]; then
    eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    alias grep='grep --color=auto'
fi

export GCC_COLORS='error=01;31:warning=01;35:note=01;36:caret=01;32:locus=01:quote=01'

# Aliases
alias ll='ls -alF --color=auto'
alias la='ls -A --color=auto'
alias l='ls -CF --color=auto'
alias ..='cd ..'
alias ...='cd ../..'
alias c='clear'
alias h='history'
alias mkdir='mkdir -pv'
alias df='df -h'
alias du='du -h'
alias free='free -h'
alias ports='netstat -tulanp'
alias now='date +"%Y-%m-%d %H:%M:%S"'
alias py='python3'
alias pip='pip3'

# Git aliases
alias gs='git status'
alias ga='git add'
alias gc='git commit'
alias gp='git push'
alias gl='git log --oneline -10'
alias gd='git diff'

# System info - CYH themed
sysinfo() {
    echo ""
    echo -e "\033[38;2;127;255;0m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
    echo -e "\033[1;37m  CYH System Information\033[0m"
    echo -e "\033[38;2;127;255;0m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
    echo -e "  \033[38;2;127;255;0m●\033[0m Hostname:  \033[1;37m$(hostname)\033[0m"
    echo -e "  \033[38;2;127;255;0m●\033[0m OS:        \033[1;37mCYH Hacking Environment\033[0m"
    echo -e "  \033[38;2;127;255;0m●\033[0m Kernel:    \033[1;37m$(uname -r)\033[0m"
    echo -e "  \033[38;2;127;255;0m●\033[0m Uptime:    \033[1;37m$(uptime -p)\033[0m"
    echo -e "  \033[38;2;127;255;0m●\033[0m Memory:    \033[1;37m$(free -h | awk '/Mem:/ {print $3 \" / \" $2}')\033[0m"
    echo -e "  \033[38;2;127;255;0m●\033[0m Shell:     \033[1;37m$SHELL\033[0m"
    echo -e "\033[38;2;127;255;0m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m"
    echo ""
}

# Enable bash completion
if ! shopt -oq posix; then
  if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
  fi
fi

export EDITOR=nano
export PATH="$HOME/.local/bin:$PATH"
BASHRC

# bash_profile
RUN echo '[ -f ~/.bashrc ] && . ~/.bashrc' > /root/.bash_profile

# inputrc
RUN cat > /root/.inputrc << 'INPUTRC'
set completion-ignore-case on
set show-all-if-ambiguous on
"\e[A": history-search-backward
"\e[B": history-search-forward
set visible-stats on
set skip-completed-text on
INPUTRC

# Sample folder with CYH branding
RUN mkdir -p /root/projects && echo "# CYH Hacking Terminal\n\nWelcome to CanYouHack Security Training Platform\nhttps://canyouhack.org" > /root/projects/README.md

# Convert CRLF to LF for all config files (Windows host compatibility)
RUN sed -i 's/\r$//' /root/.bashrc /root/.bash_profile /root/.inputrc /etc/profile.d/00-welcome.sh && \
    chmod +x /etc/profile.d/00-welcome.sh

CMD ["/bin/bash", "--login"]